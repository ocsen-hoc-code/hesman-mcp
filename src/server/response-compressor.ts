import { relative, sep } from 'node:path';
import { compactCode } from '../parsers/compact-mode.js';
import type { SqliteStore } from '../stores/sqlite.js';
import { indexState, type IndexingMarker } from '../indexing/index-state.js';

/**
 * How a list tool answers (M4-01).
 *
 * - `compact` (default): rows are arrays under named `columns` (stated once),
 *   rows are grouped by file under `files: [{ file, rows }]` (or are one flat
 *   `rows` list), and paths are project-relative with `/` separators.
 * - `full`: the plain payload, with one object per row and absolute paths.
 *
 * Every compact response carries `format: "compact"`, so the shape is visible
 * without the docs. A response is compact only when that is smaller than the
 * plain payload; otherwise the plain payload is returned with `format: "full"`.
 */
export type ResponseFormat = 'compact' | 'full';

interface CompressOptions {
  store?: SqliteStore;
  level?: 1 | 2;
  /** Pre-pipeline token count (before pruning/line-range extraction).
   *  When set, _meta.reduction compares against this baseline
   *  instead of the input data size, reflecting the full pipeline. */
  originalTokens?: number;
  /** Compact code content (Layer 1). Default true; `get_context` passes false for `mode: "full"`. */
  compact?: boolean;
  /** Shape of a list tool's answer. Default `compact`. Ignored by tools without a compact shape. */
  format?: ResponseFormat;
  /** Project root: compact shapes write paths relative to it. Without it paths stay as given. */
  projectRoot?: string;
}

// Tools that should not be compressed
const NO_COMPRESS = new Set(['index_status']);

// Tools with code content to compact
const CODE_TOOLS = new Set(['get_context']);

/** One entry of `get_callers` / `get_callees` (plain payload). */
interface CallEntry {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  depth: number;
  callSite?: { filePath?: string; line?: number };
}
/** One row of `get_references` (plain payload). */
interface ReferenceEntry {
  filePath: string;
  line: number;
  col: number;
  kind: string;
  callerSymbolId: string;
  callerName: string | null;
}
/** One row of `find_symbol` (plain payload). */
interface SymbolEntry {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string | null;
  docComment: string | null;
  isExported: boolean;
  language: string;
}
/** One node of the `get_file_structure` tree (plain payload). */
interface SymbolNode {
  id: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  signature?: string | null;
  isExported: boolean;
  children?: SymbolNode[];
}
/** One row of `list_dependencies` (plain payload). */
interface DependencyEntry {
  target: string;
  kind: string;
  importedSymbols: string[];
  count: number;
}
/** One impacted file of `impact_analysis` (plain payload). */
interface ImpactFileEntry {
  filePath: string;
  severity: string;
  reason: string;
  locations?: Array<{ line: number; col: number; kind: string; action: string; currentCode: string }>;
}

/** Shape of one list tool in the compact format. */
type CompactShape<T> =
  | {
      /** Rows grouped by the file of each row: `files: [{ file, rows }]`. */
      kind: 'grouped';
      list: string;
      columns: string[];
      fileOf: (item: T) => string;
      row: (item: T, file: string, root: string | undefined) => unknown[];
    }
  | {
      /** One flat list of rows: `rows`. */
      kind: 'flat';
      list: string;
      columns: string[];
      row: (item: T) => unknown[];
    };

/** Call-chain entries (`get_callers`, `get_callees`): the call site is shown only when it is in another file. */
const CALL_COLUMNS = ['symbolId', 'name', 'kind', 'line', 'depth', 'callLine', 'callFile'];
function callRow(entry: CallEntry, _file: string, root: string | undefined): unknown[] {
  const site = entry.callSite ?? {};
  const callFile = site.filePath === undefined || site.filePath === entry.filePath ? null : toProjectPath(root, site.filePath);
  return [entry.symbolId, entry.name, entry.kind, entry.startLine, entry.depth, site.line ?? null, callFile];
}
const callShape = (list: string): CompactShape<CallEntry> => ({
  kind: 'grouped',
  list,
  columns: CALL_COLUMNS,
  fileOf: (e) => e.filePath,
  row: callRow,
});

// The registry holds shapes for different row types; each entry is typed by its own interface above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMPACT_SHAPES: Record<string, CompactShape<any>> = {
  get_references: {
    kind: 'grouped',
    list: 'references',
    columns: ['line', 'col', 'kind', 'callerSymbolId', 'callerName'],
    fileOf: (r: ReferenceEntry) => r.filePath,
    row: (r: ReferenceEntry) => [r.line, r.col, r.kind, r.callerSymbolId, r.callerName],
  },
  get_callers: callShape('callers'),
  get_callees: callShape('callees'),
  find_symbol: {
    kind: 'grouped',
    list: 'symbols',
    columns: ['id', 'name', 'kind', 'line', 'endLine', 'signature', 'docComment', 'isExported', 'language'],
    fileOf: (s: SymbolEntry) => s.filePath,
    row: (s: SymbolEntry) => [s.id, s.name, s.kind, s.startLine, s.endLine, s.signature, s.docComment, s.isExported, s.language],
  },
  list_dependencies: {
    kind: 'flat',
    list: 'dependencies',
    columns: ['target', 'kind', 'importedSymbols', 'count'],
    row: (d: DependencyEntry) => [d.target, d.kind, d.importedSymbols, d.count],
  },
};

/** Names of the list tools that accept `format` (their compact shape is in `COMPACT_SHAPES` or handled below). */
export const FORMAT_TOOLS: ReadonlySet<string> = new Set([
  ...Object.keys(COMPACT_SHAPES),
  'get_file_structure',
  'impact_analysis',
]);

/** Project-relative path with `/` separators; the path unchanged when it is outside the root or no root is given. */
export function toProjectPath(root: string | undefined, path: string): string {
  if (!root || !path) return path;
  const rel = relative(root, path);
  if (rel === '' || rel.startsWith('..') || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)) return path;
  return rel.split(sep).join('/');
}

/** Rows grouped by their file, in first-seen order. */
function groupByFile<T>(items: T[], fileOf: (item: T) => string, row: (item: T, file: string) => unknown[]) {
  const groups = new Map<string, unknown[][]>();
  for (const item of items) {
    const file = fileOf(item);
    let rows = groups.get(file);
    if (!rows) {
      rows = [];
      groups.set(file, rows);
    }
    rows.push(row(item, file));
  }
  return [...groups].map(([file, rows]) => ({ file, rows }));
}

/** get_file_structure: the nested children become rows with a `parentId` column (null for top-level symbols). */
const FILE_STRUCTURE_COLUMNS = ['id', 'name', 'kind', 'line', 'endLine', 'signature', 'isExported', 'parentId'];
function fileStructureRows(symbols: SymbolNode[]): unknown[][] {
  const rows: unknown[][] = [];
  const add = (s: SymbolNode, parentId: string | null) => {
    rows.push([s.id, s.name, s.kind, s.startLine, s.endLine, s.signature ?? null, s.isExported, parentId]);
    for (const child of s.children ?? []) add(child, s.id);
  };
  for (const s of symbols) add(s, null);
  return rows;
}

/** impact_analysis: one group per impacted file; the locations are rows. */
const IMPACT_COLUMNS = ['line', 'col', 'kind', 'action', 'currentCode'];
function impactFiles(files: ImpactFileEntry[], root: string | undefined) {
  return files.map((f) => ({
    file: toProjectPath(root, f.filePath),
    severity: f.severity,
    reason: f.reason,
    rows: (f.locations ?? []).map((l) => [l.line, l.col, l.kind, l.action, l.currentCode]),
  }));
}

/**
 * The compact form of a list response, without `_meta`. `null` when the tool has
 * no compact shape or the payload is not the shape the tool produces.
 */
function compactPayload(toolName: string, data: Record<string, unknown>, root: string | undefined): Record<string, unknown> | null {
  if (toolName === 'get_file_structure' && Array.isArray(data.symbols)) {
    const { symbols, file, ...rest } = data as { symbols: SymbolNode[]; file: string } & Record<string, unknown>;
    return {
      format: 'compact',
      file: toProjectPath(root, file),
      ...rest,
      columns: FILE_STRUCTURE_COLUMNS,
      rows: fileStructureRows(symbols),
    };
  }
  if (toolName === 'impact_analysis' && Array.isArray(data.impactedFiles)) {
    const { impactedFiles, symbol, ...rest } = data as {
      impactedFiles: ImpactFileEntry[];
      symbol: { filePath: string } & Record<string, unknown>;
    } & Record<string, unknown>;
    return {
      format: 'compact',
      symbol: symbol && typeof symbol === 'object' ? { ...symbol, filePath: toProjectPath(root, symbol.filePath) } : symbol,
      ...rest,
      columns: IMPACT_COLUMNS,
      files: impactFiles(impactedFiles, root),
    };
  }
  const shape = COMPACT_SHAPES[toolName];
  if (!shape || !Array.isArray(data[shape.list])) return null;
  const { [shape.list]: items, ...rest } = data;
  if (shape.kind === 'flat') {
    const file = typeof rest.file === 'string' ? toProjectPath(root, rest.file) : rest.file;
    return {
      format: 'compact',
      ...rest,
      ...(file !== undefined ? { file } : {}),
      columns: shape.columns,
      rows: (items as unknown[]).map((item) => shape.row(item)),
    };
  }
  return {
    format: 'compact',
    ...rest,
    columns: shape.columns,
    files: groupByFile(items as unknown[], (item) => toProjectPath(root, shape.fileOf(item)), (item, file) =>
      shape.row(item, file, root),
    ),
  };
}

/** Tokens the layer names of a compact list answer add to `_meta` (`"group","columns","paths"`). */
const COMPACT_LAYERS_TOKENS = 7;

export function compressToolResponse(
  toolName: string,
  data: Record<string, unknown>,
  options?: CompressOptions,
): Record<string, unknown> {
  if (NO_COMPRESS.has(toolName)) return data;

  const level = options?.level ?? 1;
  const format: ResponseFormat = options?.format ?? 'compact';
  const isListShape = FORMAT_TOOLS.has(toolName);

  // The plain payload: what the tool produced. List tools label it as the full format.
  const plain: Record<string, unknown> = isListShape ? { format: 'full', ...data } : { ...data };
  const plainTokens = estimateTokens(JSON.stringify(plain));

  // The candidate that replaces it: the compact list shape, or for code tools
  // the compacted content (Layer 1; `get_context` passes compact: false for mode "full").
  let candidate: Record<string, unknown> | null = null;
  if (isListShape && format === 'compact') {
    candidate = compactPayload(toolName, data, options?.projectRoot);
  } else if (CODE_TOOLS.has(toolName) && options?.compact !== false && typeof data.content === 'string') {
    candidate = { ...data, content: compactCode(data.content, { level }) };
  }

  // Never return something larger than the plain payload: the candidate is
  // used only when it is strictly smaller.
  // The compact list shape also names its layers in `_meta`, which the plain
  // answer does not; count that so the whole response is never larger either.
  const candidateTokens = candidate ? estimateTokens(JSON.stringify(candidate)) : Infinity;
  const layerOverhead = isListShape ? COMPACT_LAYERS_TOKENS : 0;
  const compressed = candidate !== null && candidateTokens + layerOverhead < plainTokens;
  const output: Record<string, unknown> = compressed && candidate ? candidate : plain;
  const outputTokens = compressed ? candidateTokens : plainTokens;

  // Baseline: the plain payload, or the pre-pipeline size (e.g. the full file
  // before pruning) when that is larger. Taking the max guarantees the output
  // never exceeds the baseline, so reduction is never negative.
  const pipelineBaseline = Math.max(plainTokens, options?.originalTokens ?? 0);
  const reduction = pipelineBaseline > 0
    ? `${(Math.max(0, 1 - outputTokens / pipelineBaseline) * 100).toFixed(1)}%`
    : '0.0%';

  // Determine which layers were active
  const layers: string[] = [];
  if (compressed && isListShape) {
    if ('files' in output) layers.push('group');
    layers.push('columns');
    if (options?.projectRoot) layers.push('paths');
  }
  if (compressed && CODE_TOOLS.has(toolName)) layers.push('compact');
  if (options?.originalTokens !== undefined && options.originalTokens > plainTokens) layers.push('prune');

  output._meta = {
    originalTokens: pipelineBaseline,
    compressedTokens: outputTokens,
    reduction,
    compressed,
    layers,
    // While the initial index runs, results may be incomplete. Omitted when
    // idle so normal responses do not grow.
    ...indexingMarker(),
  };

  return output;
}

function indexingMarker(): { indexing?: IndexingMarker } {
  const indexing = indexState.marker();
  return indexing ? { indexing } : {};
}

export function estimateTokens(text: string): number {
  // Rough estimate: 4 chars ≈ 1 token for code
  return Math.ceil(text.length / 4);
}
