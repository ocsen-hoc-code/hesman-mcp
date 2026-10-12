import type BetterSqlite3 from 'better-sqlite3';
import { importedFiles } from '../../indexing/call-resolver.js';
import { toProjectRelative } from './relative-paths.js';

/**
 * Graph queries of the dashboard, straight on the read-only index connection.
 *
 * Every query is bounded: it reads through an index (`symbols.id`,
 * `idx_symbols_file`, `idx_relations_from`, `idx_relations_to`,
 * `idx_relations_kind`) and carries a `LIMIT`, so a symbol with a hundred
 * thousand callers costs the same as one with a hundred. When a bound cuts the
 * result, `truncated` is `true`. The one scan is the substring match of
 * `searchSymbols` (`LIKE '%q%'` cannot use an index): one pass over the
 * `symbols` table, a few milliseconds for tens of thousands of rows.
 */

/** SQLite caps bound parameters; stay well below the limit. */
const IN_CHUNK = 400;

export const SEARCH_LIMIT = { default: 30, min: 1, max: 200 };
export const NEIGHBORHOOD_LIMIT = { default: 80, min: 1, max: 500 };
export const NEIGHBORHOOD_DEPTH = { default: 1, min: 1, max: 3 };
export const FILE_GRAPH_LIMIT = { default: 200, min: 1, max: 1000 };

/** Relation rows read per traversal step, per returned node. */
const ROWS_PER_NODE = 8;
/** Edges returned per node of the result. */
const EDGES_PER_NODE = 10;
/** Import relations read for the file graph. */
const MAX_IMPORT_ROWS = 50_000;

function chunked<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const marks = (count: number): string => Array.from({ length: count }, () => '?').join(',');

interface SymbolNodeRow {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  language: string;
  is_exported: number;
}

const NODE_COLUMNS = 's.id, s.name, s.kind, s.file_path, s.start_line, s.end_line, s.language, s.is_exported';

export interface SearchSymbol {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  isExported: boolean;
}

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  language: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  /** 1-based line of the call, import, ... */
  line: number;
}

function toNode(row: SymbolNodeRow, projectRoot: string): GraphNode {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    filePath: toProjectRelative(projectRoot, row.file_path),
    startLine: row.start_line,
    language: row.language,
  };
}

/** Treats `%`, `_` and `\` in user text as plain characters of a LIKE pattern. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Symbols whose name contains `q` (case-insensitive for ASCII): exact names
 * first, then names starting with `q`, then shorter names. An empty `q` lists
 * symbols by name.
 */
export function searchSymbols(
  db: BetterSqlite3.Database,
  projectRoot: string,
  query: { q: string; kind?: string; language?: string; limit: number },
): SearchSymbol[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query.q.length > 0) {
    where.push("s.name LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(query.q)}%`);
  }
  if (query.kind) {
    where.push('s.kind = ?');
    params.push(query.kind);
  }
  if (query.language) {
    where.push('s.language = ?');
    params.push(query.language);
  }

  let order = 's.name, s.file_path, s.start_line';
  if (query.q.length > 0) {
    order = `(s.name = ? COLLATE NOCASE) DESC, (s.name LIKE ? ESCAPE '\\') DESC, length(s.name), ${order}`;
    params.push(query.q, `${escapeLike(query.q)}%`);
  }
  params.push(query.limit);

  const rows = db
    .prepare(
      `SELECT ${NODE_COLUMNS} FROM symbols s ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${order} LIMIT ?`,
    )
    .all(...params) as SymbolNodeRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    filePath: toProjectRelative(projectRoot, row.file_path),
    startLine: row.start_line,
    endLine: row.end_line,
    language: row.language,
    isExported: row.is_exported === 1,
  }));
}

export interface Neighborhood {
  center: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

/**
 * The symbols within `depth` relations of `symbolId`, in either direction and
 * of every relation kind, plus every relation among the returned symbols.
 * At most `limit` nodes (the center included). `null` for an unknown id.
 */
export function neighborhood(
  db: BetterSqlite3.Database,
  projectRoot: string,
  query: { symbolId: string; depth: number; limit: number },
): Neighborhood | null {
  const center = db.prepare(`SELECT ${NODE_COLUMNS} FROM symbols s WHERE s.id = ?`).get(query.symbolId) as
    | SymbolNodeRow
    | undefined;
  if (!center) return null;

  const nodes = new Map<string, SymbolNodeRow>([[center.id, center]]);
  let truncated = false;
  let frontier = [center.id];
  const rowCap = (query.limit + 1) * ROWS_PER_NODE;

  for (let level = 0; level < query.depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const part of chunked(frontier)) {
      // Two indexed lookups per step: what the frontier points at, and what points at it.
      for (const [own, other] of [
        ['from_id', 'to_id'],
        ['to_id', 'from_id'],
      ]) {
        const rows = db
          .prepare(
            `SELECT ${NODE_COLUMNS} FROM relations r JOIN symbols s ON s.id = r.${other}
             WHERE r.${own} IN (${marks(part.length)}) LIMIT ?`,
          )
          .all(...part, rowCap) as SymbolNodeRow[];
        if (rows.length >= rowCap) truncated = true;
        for (const row of rows) {
          if (nodes.has(row.id)) continue;
          if (nodes.size >= query.limit) {
            truncated = true;
            continue;
          }
          nodes.set(row.id, row);
          next.push(row.id);
        }
      }
    }
    frontier = next;
  }

  const ids = [...nodes.keys()];
  const edgeCap = Math.max(ids.length * EDGES_PER_NODE, 50);
  const edges = new Map<string, GraphEdge>();
  outer: for (const fromPart of chunked(ids)) {
    for (const toPart of chunked(ids)) {
      const rows = db
        .prepare(
          `SELECT from_id, to_id, kind, line FROM relations
           WHERE from_id IN (${marks(fromPart.length)}) AND to_id IN (${marks(toPart.length)})
           ORDER BY from_id, to_id, kind, line LIMIT ?`,
        )
        .all(...fromPart, ...toPart, edgeCap + 1) as Array<{ from_id: string; to_id: string; kind: string; line: number }>;
      for (const row of rows) {
        if (edges.size >= edgeCap) {
          truncated = true;
          break outer;
        }
        edges.set(`${row.from_id}\0${row.to_id}\0${row.kind}\0${row.line}`, {
          from: row.from_id,
          to: row.to_id,
          kind: row.kind,
          line: row.line,
        });
      }
    }
  }

  return {
    center: toNode(center, projectRoot),
    nodes: [...nodes.values()].map((row) => toNode(row, projectRoot)),
    edges: [...edges.values()],
    truncated,
  };
}

export interface FileGraph {
  nodes: Array<{ id: string; language: string; symbols: number }>;
  edges: Array<{ from: string; to: string; count: number }>;
  truncated: boolean;
}

/**
 * The `limit` files with the most symbols and, between them, how many
 * relations (calls, extends, ... and relative imports) lead from one file to
 * another. Files of the text tier have no symbols and are not part of it.
 */
export function fileGraph(db: BetterSqlite3.Database, projectRoot: string, query: { limit: number }): FileGraph {
  const fileRows = db
    .prepare(
      `SELECT file_path, MIN(language) AS language, COUNT(*) AS symbols FROM symbols
       GROUP BY file_path ORDER BY symbols DESC, file_path ASC LIMIT ?`,
    )
    .all(query.limit + 1) as Array<{ file_path: string; language: string; symbols: number }>;
  let truncated = fileRows.length > query.limit;
  const files = fileRows.slice(0, query.limit);
  const known = new Set(files.map((f) => f.file_path));

  const counts = new Map<string, { from: string; to: string; count: number }>();
  const add = (from: string, to: string, count: number): void => {
    if (from === to || !known.has(from) || !known.has(to)) return;
    const key = `${from}\0${to}`;
    const edge = counts.get(key);
    if (edge) edge.count += count;
    else counts.set(key, { from, to, count });
  };

  // Relations whose target is a symbol of another file. The join starts at the
  // symbols of the returned files, so its cost follows `limit`, not the project.
  for (const part of chunked(files.map((f) => f.file_path))) {
    const rows = db
      .prepare(
        `SELECT sf.file_path AS from_file, st.file_path AS to_file, COUNT(*) AS count
         FROM symbols sf
         CROSS JOIN relations r ON r.from_id = sf.id
         CROSS JOIN symbols st ON st.id = r.to_id
         WHERE sf.file_path IN (${marks(part.length)}) AND st.file_path <> sf.file_path
         GROUP BY sf.file_path, st.file_path`,
      )
      .all(...part) as Array<{ from_file: string; to_file: string; count: number }>;
    for (const row of rows) add(row.from_file, row.to_file, row.count);
  }

  // Imports are stored by specifier (`unresolved:./greet.js`); map the relative ones to files.
  const imports = db
    .prepare(
      `SELECT file_path, to_id, COUNT(*) AS count FROM relations
       WHERE kind = 'imports' AND to_id LIKE 'unresolved:.%'
       GROUP BY file_path, to_id LIMIT ?`,
    )
    .all(MAX_IMPORT_ROWS + 1) as Array<{ file_path: string; to_id: string; count: number }>;
  if (imports.length > MAX_IMPORT_ROWS) truncated = true;
  for (const row of imports.slice(0, MAX_IMPORT_ROWS)) {
    if (!known.has(row.file_path)) continue;
    for (const candidate of importedFiles(row.file_path, [row.to_id.slice('unresolved:'.length)])) {
      if (known.has(candidate) && candidate !== row.file_path) {
        add(row.file_path, candidate, row.count);
        break;
      }
    }
  }

  const edgeCap = Math.max(files.length * EDGES_PER_NODE, 50);
  const edges = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
  if (edges.length > edgeCap) truncated = true;

  return {
    nodes: files.map((f) => ({
      id: toProjectRelative(projectRoot, f.file_path),
      language: f.language,
      symbols: f.symbols,
    })),
    edges: edges.slice(0, edgeCap).map((e) => ({
      from: toProjectRelative(projectRoot, e.from),
      to: toProjectRelative(projectRoot, e.to),
      count: e.count,
    })),
    truncated,
  };
}
