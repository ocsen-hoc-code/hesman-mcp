import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createLogger } from '../utils/logger';

const log = createLogger('sqlite');

export interface SymbolRow {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  start_col: number;
  end_col: number;
  signature: string | null;
  doc_comment: string | null;
  parent_id: string | null;
  language: string;
  is_exported: number;
  updated_at: number;
}

export interface RelationRow {
  from_id: string;
  to_id: string;
  kind: string;
  file_path: string;
  line: number;
  col: number;
}

export interface CallerResult {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  depth: number;
  callSite: { filePath: string; line: number };
}

export interface CalleeResult {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  depth: number;
  callSite: { filePath: string; line: number };
}

export interface ReferenceResult {
  filePath: string;
  line: number;
  col: number;
  kind: string;
  callerSymbolId: string | null;
  callerName: string | null;
}

export interface DependencyResult {
  target: string;
  kind: 'local_file' | 'package' | 'unresolved';
  importedSymbols: string[];
  count: number;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS symbols (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    start_line  INTEGER NOT NULL,
    end_line    INTEGER NOT NULL,
    start_col   INTEGER NOT NULL DEFAULT 0,
    end_col     INTEGER NOT NULL DEFAULT 0,
    signature   TEXT,
    doc_comment TEXT,
    parent_id   TEXT,
    language    TEXT NOT NULL,
    is_exported INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_lang ON symbols(language)`,
  `CREATE TABLE IF NOT EXISTS file_hashes (
    file_path TEXT PRIMARY KEY,
    sha256    TEXT NOT NULL,
    parsed_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS relations (
    from_id   TEXT NOT NULL,
    to_id     TEXT NOT NULL,
    kind      TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line      INTEGER NOT NULL,
    col       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (from_id, to_id, kind, file_path, line)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id)`,
  `CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id)`,
  `CREATE INDEX IF NOT EXISTS idx_relations_kind ON relations(kind)`,
];

export class SqliteStore {
  private db!: BetterSqlite3.Database;
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  open(): void {
    mkdirSync(this.dataDir, { recursive: true });
    const dbPath = join(this.dataDir, 'symbols.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.runMigrations();
    log.info({ dbPath }, 'SQLite store opened');
  }

  close(): void {
    if (this.db) {
      this.db.close();
      log.info('SQLite store closed');
    }
  }

  private runMigrations(): void {
    for (const sql of MIGRATIONS) {
      this.db.exec(sql);
    }
  }

  upsertSymbols(symbols: SymbolRow[]): void {
    if (symbols.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols
        (id, name, kind, file_path, start_line, end_line, start_col, end_col, signature, doc_comment, parent_id, language, is_exported, updated_at)
      VALUES
        (@id, @name, @kind, @file_path, @start_line, @end_line, @start_col, @end_col, @signature, @doc_comment, @parent_id, @language, @is_exported, @updated_at)
    `);
    const insertMany = this.db.transaction((rows: SymbolRow[]) => {
      for (const row of rows) stmt.run(row);
    });
    insertMany(symbols);
  }

  getSymbolsByName(name: string): SymbolRow[] {
    const stmt = this.db.prepare('SELECT * FROM symbols WHERE name = ?');
    return stmt.all(name) as SymbolRow[];
  }

  getSymbolsByFile(filePath: string): SymbolRow[] {
    const stmt = this.db.prepare('SELECT * FROM symbols WHERE file_path = ? ORDER BY start_line');
    return stmt.all(filePath) as SymbolRow[];
  }

  clearSymbols(filePath: string): void {
    const stmt = this.db.prepare('DELETE FROM symbols WHERE file_path = ?');
    stmt.run(filePath);
  }

  getStats(): { totalFiles: number; totalSymbols: number; lastIndexTime: number | null } {
    const fileCount = this.db.prepare('SELECT COUNT(DISTINCT file_path) as count FROM symbols').get() as { count: number };
    const symCount = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number };
    const lastTime = this.db.prepare('SELECT MAX(parsed_at) as max_time FROM file_hashes').get() as { max_time: number | null };
    return {
      totalFiles: fileCount.count,
      totalSymbols: symCount.count,
      lastIndexTime: lastTime.max_time,
    };
  }

  upsertFileHash(filePath: string, sha256: string): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO file_hashes (file_path, sha256, parsed_at) VALUES (?, ?, ?)');
    stmt.run(filePath, sha256, Date.now());
  }

  getFileHash(filePath: string): string | null {
    const stmt = this.db.prepare('SELECT sha256 FROM file_hashes WHERE file_path = ?');
    const row = stmt.get(filePath) as { sha256: string } | undefined;
    return row?.sha256 ?? null;
  }

  upsertRelations(relations: RelationRow[]): void {
    if (relations.length === 0) return;
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO relations (from_id, to_id, kind, file_path, line, col) VALUES (@from_id, @to_id, @kind, @file_path, @line, @col)',
    );
    const insertMany = this.db.transaction((rows: RelationRow[]) => {
      for (const row of rows) stmt.run(row);
    });
    insertMany(relations);
  }

  clearRelations(filePath: string): void {
    this.db.prepare('DELETE FROM relations WHERE file_path = ?').run(filePath);
  }

  getTotalRelations(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM relations').get() as { count: number }).count;
  }

  getReferences(
    symbolId: string,
    kind?: string,
    topK: number = 50,
    cursor?: string,
  ): { refs: ReferenceResult[]; totalCount: number; hasMore: boolean; nextCursor: string | null } {
    let where = 'WHERE r.to_id = ?';
    const params: any[] = [symbolId];
    if (kind) { where += ' AND r.kind = ?'; params.push(kind); }

    // Decode cursor: base64(file_path:line)
    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      const [lastFile, lastLine] = decoded.split(':');
      where += ' AND (r.file_path > ? OR (r.file_path = ? AND r.line > ?))';
      params.push(lastFile, lastFile, parseInt(lastLine, 10));
    }

    const countQuery = `SELECT COUNT(*) as count FROM relations r ${where}`;
    const totalCount = (this.db.prepare(countQuery).get(...params) as { count: number }).count;

    const rows = this.db.prepare(
      `SELECT r.from_id, r.file_path, r.line, r.col, r.kind, s.name as caller_name
       FROM relations r
       LEFT JOIN symbols s ON s.id = r.from_id
       ${where}
       ORDER BY r.file_path, r.line
       LIMIT ?`,
    ).all(...params, topK + 1) as any[];

    const hasMore = rows.length > topK;
    const refs = rows.slice(0, topK).map((r: any) => ({
      filePath: r.file_path,
      line: r.line,
      col: r.col,
      kind: r.kind,
      callerSymbolId: r.from_id,
      callerName: r.caller_name ?? null,
    }));

    const nextCursor = hasMore && refs.length > 0
      ? Buffer.from(`${refs[refs.length - 1].filePath}:${refs[refs.length - 1].line}`).toString('base64')
      : null;

    return { refs, totalCount, hasMore, nextCursor };
  }

  getCallers(symbolId: string, maxDepth: number = 1, topK: number = 50): CallerResult[] {
    const rows = this.db.prepare(`
      WITH RECURSIVE caller_chain AS (
        SELECT from_id, to_id, kind, file_path, line, 1 AS depth
        FROM relations
        WHERE to_id = ? AND kind = 'calls'
        UNION ALL
        SELECT r.from_id, r.to_id, r.kind, r.file_path, r.line, cc.depth + 1
        FROM relations r
        JOIN caller_chain cc ON r.to_id = cc.from_id
        WHERE r.kind = 'calls' AND cc.depth < ?
      )
      SELECT DISTINCT s.id, s.name, s.kind, s.file_path, s.start_line,
             cc.depth, cc.file_path AS call_file, cc.line AS call_line
      FROM caller_chain cc
      JOIN symbols s ON s.id = cc.from_id
      ORDER BY cc.depth
      LIMIT ?
    `).all(symbolId, maxDepth, topK) as any[];

    return rows.map((r: any) => ({
      symbolId: r.id,
      name: r.name,
      kind: r.kind,
      filePath: r.file_path,
      startLine: r.start_line,
      depth: r.depth,
      callSite: { filePath: r.call_file, line: r.call_line },
    }));
  }

  getCallees(symbolId: string, maxDepth: number = 1, topK: number = 50): CalleeResult[] {
    const rows = this.db.prepare(`
      WITH RECURSIVE callee_chain AS (
        SELECT from_id, to_id, kind, file_path, line, 1 AS depth
        FROM relations
        WHERE from_id = ? AND kind = 'calls'
        UNION ALL
        SELECT r.from_id, r.to_id, r.kind, r.file_path, r.line, cc.depth + 1
        FROM relations r
        JOIN callee_chain cc ON r.from_id = cc.to_id
        WHERE r.kind = 'calls' AND cc.depth < ?
      )
      SELECT DISTINCT s.id, s.name, s.kind, s.file_path, s.start_line,
             cc.depth, cc.file_path AS call_file, cc.line AS call_line
      FROM callee_chain cc
      JOIN symbols s ON s.id = cc.to_id
      ORDER BY cc.depth
      LIMIT ?
    `).all(symbolId, maxDepth, topK) as any[];

    return rows.map((r: any) => ({
      symbolId: r.id,
      name: r.name,
      kind: r.kind,
      filePath: r.file_path,
      startLine: r.start_line,
      depth: r.depth,
      callSite: { filePath: r.call_file, line: r.call_line },
    }));
  }

  getDependencies(
    filePath?: string,
    direction: 'imports' | 'imported_by' | 'both' = 'imports',
  ): DependencyResult[] {
    let where = "WHERE kind = 'imports'";
    const params: any[] = [];

    if (filePath) {
      if (direction === 'imports') {
        where += ' AND file_path = ?';
        params.push(filePath);
      } else if (direction === 'imported_by') {
        where += ' AND to_id IN (SELECT id FROM symbols WHERE file_path = ?)';
        params.push(filePath);
      }
      // 'both' — no file filter
    }

    const rows = this.db.prepare(`
      SELECT to_id, COUNT(*) as count
      FROM relations
      ${where}
      GROUP BY to_id
      ORDER BY count DESC
    `).all(...params) as any[];

    return rows.map((r: any) => {
      // Determine kind: local file if to_id looks like a symbol ID (hex), package if "unresolved:*", else local_file
      const isUnresolved = r.to_id.startsWith('unresolved:');
      const target = isUnresolved ? r.to_id.slice('unresolved:'.length) : r.to_id;
      return {
        target,
        kind: isUnresolved ? 'unresolved' as const : 'local_file' as const,
        importedSymbols: [], // Phase 3: not tracking individual symbols
        count: r.count,
      };
    });
  }
}
