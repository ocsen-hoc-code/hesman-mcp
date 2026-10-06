import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';

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

/**
 * Version of the data written into an index. Bump it whenever stored values
 * change meaning; an index with an older version is cleared and rebuilt.
 *   0 — no version recorded (pre-M0-14): 0-based line numbers.
 *   1 — every stored line number is 1-based, inclusive (M0-14).
 */
export const INDEX_SCHEMA_VERSION = 1;

const INDEX_SCHEMA_VERSION_KEY = 'index_schema_version';
/**
 * Schema version of the ZVec documents, tracked apart from the SQLite data:
 * a run without ZVec can bring SQLite up to date while old vectors stay on disk.
 */
const VECTOR_SCHEMA_VERSION_KEY = 'vector_schema_version';

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
  // Migration: FTS5 virtual table for fuzzy search
  `CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    name,
    kind,
    signature,
    content='symbols',
    content_rowid='rowid'
  )`,
  `CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

function withRetry<T>(fn: () => T, maxRetries = 3): T {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return fn();
    } catch (err: any) {
      if (err?.code === 'SQLITE_BUSY' && i < maxRetries - 1) {
        const waitMs = Math.pow(10, i + 1);
        // Sleep without external dependency
        Atomics.wait?.(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
        continue;
      }
      throw err;
    }
  }
  throw new Error('SQLITE_BUSY after max retries');
}

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
    this.ensureFtsTriggers();
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

  private ensureFtsTriggers(): void {
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
        INSERT INTO symbols_fts(rowid, name, kind, signature)
        VALUES (new.rowid, new.name, new.kind, new.signature);
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
        INSERT INTO symbols_fts(symbols_fts, rowid, name, kind, signature)
        VALUES ('delete', old.rowid, old.name, old.kind, old.signature);
      END;

      CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
        INSERT INTO symbols_fts(symbols_fts, rowid, name, kind, signature)
        VALUES ('delete', old.rowid, old.name, old.kind, old.signature);
        INSERT INTO symbols_fts(rowid, name, kind, signature)
        VALUES (new.rowid, new.name, new.kind, new.signature);
      END;
    `);
  }

  /** Version of the indexed data, or 0 when the index predates versioning. */
  getIndexSchemaVersion(): number {
    const row = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get(INDEX_SCHEMA_VERSION_KEY) as { value: string } | undefined;
    const version = row ? Number(row.value) : 0;
    return Number.isInteger(version) ? version : 0;
  }

  setIndexSchemaVersion(version: number): void {
    this.setMetadataNumber(INDEX_SCHEMA_VERSION_KEY, version);
  }

  /**
   * Schema version of the ZVec documents, or `undefined` when none was recorded
   * (the vectors then share the SQLite schema version).
   */
  getVectorSchemaVersion(): number | undefined {
    const row = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get(VECTOR_SCHEMA_VERSION_KEY) as { value: string } | undefined;
    if (!row) return undefined;
    const version = Number(row.value);
    return Number.isInteger(version) ? version : 0;
  }

  setVectorSchemaVersion(version: number): void {
    this.setMetadataNumber(VECTOR_SCHEMA_VERSION_KEY, version);
  }

  private setMetadataNumber(key: string, value: number): void {
    withRetry(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
        .run(key, String(value));
    });
  }

  /** Drop every symbol, relation and file hash so the next index run starts from scratch. */
  clearIndex(): void {
    withRetry(() => {
      this.db.transaction(() => {
        this.db.exec('DELETE FROM symbols; DELETE FROM relations; DELETE FROM file_hashes;');
      })();
    });
  }

  upsertSymbols(symbols: SymbolRow[]): void {
    withRetry(() => {
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
    });
  }

  getSymbolById(id: string): SymbolRow | undefined {
    return this.db.prepare('SELECT * FROM symbols WHERE id = ?').get(id) as SymbolRow | undefined;
  }

  getSymbolsByName(
    name: string,
    kind?: string,
    filePath?: string,
    topK: number = 20,
    matchMode: 'exact' | 'prefix' | 'fuzzy' = 'exact',
  ): SymbolRow[] {
    switch (matchMode) {
      case 'exact': {
        let sql = 'SELECT * FROM symbols WHERE name = ?';
        const params: any[] = [name];
        if (kind) { sql += ' AND kind = ?'; params.push(kind); }
        if (filePath) { sql += ' AND file_path = ?'; params.push(filePath); }
        sql += ' LIMIT ?'; params.push(topK);
        return this.db.prepare(sql).all(...params) as SymbolRow[];
      }
      case 'prefix': {
        let sql = 'SELECT * FROM symbols WHERE name LIKE ?';
        const params: any[] = [name + '%'];
        if (kind) { sql += ' AND kind = ?'; params.push(kind); }
        if (filePath) { sql += ' AND file_path = ?'; params.push(filePath); }
        sql += ' LIMIT ?'; params.push(topK);
        return this.db.prepare(sql).all(...params) as SymbolRow[];
      }
      case 'fuzzy': {
        // Escape FTS5 special characters and keywords
        // FTS5 treats these as special: ()*"^~+ AND OR NOT NEAR
        // Wrap in double-quotes for phrase matching, escape embedded quotes
        const escaped = '"' + name.replace(/"/g, '""') + '"';
        let sql = `
          SELECT s.*, fts.rank
          FROM symbols_fts fts
          JOIN symbols s ON s.rowid = fts.rowid
          WHERE symbols_fts MATCH ?
        `;
        const params: any[] = [escaped + '*'];
        if (kind) { sql += ' AND s.kind = ?'; params.push(kind); }
        if (filePath) { sql += ' AND s.file_path = ?'; params.push(filePath); }
        sql += ' ORDER BY fts.rank LIMIT ?'; params.push(topK);
        return this.db.prepare(sql).all(...params) as SymbolRow[];
      }
      default:
        return this.getSymbolsByName(name, kind, filePath, topK, 'exact');
    }
  }

  getSymbolsByFile(filePath: string): SymbolRow[] {
    const stmt = this.db.prepare('SELECT * FROM symbols WHERE file_path = ? ORDER BY start_line');
    return stmt.all(filePath) as SymbolRow[];
  }

  clearSymbols(filePath: string): void {
    withRetry(() => {
      this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
    });
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

  /** Indexed files and symbols per language, most files first (ties by name). */
  getLanguageStats(): Array<{ language: string; files: number; symbols: number }> {
    return this.db.prepare(
      `SELECT language, COUNT(DISTINCT file_path) AS files, COUNT(*) AS symbols
       FROM symbols GROUP BY language ORDER BY files DESC, language ASC`,
    ).all() as Array<{ language: string; files: number; symbols: number }>;
  }

  upsertFileHash(filePath: string, sha256: string): void {
    withRetry(() => {
      this.db.prepare('INSERT OR REPLACE INTO file_hashes (file_path, sha256, parsed_at) VALUES (?, ?, ?)').run(filePath, sha256, Date.now());
    });
  }

  getFileHash(filePath: string): string | null {
    const stmt = this.db.prepare('SELECT sha256 FROM file_hashes WHERE file_path = ?');
    const row = stmt.get(filePath) as { sha256: string } | undefined;
    return row?.sha256 ?? null;
  }

  upsertRelations(relations: RelationRow[]): void {
    withRetry(() => {
      if (relations.length === 0) return;
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO relations (from_id, to_id, kind, file_path, line, col) VALUES (@from_id, @to_id, @kind, @file_path, @line, @col)',
      );
      const insertMany = this.db.transaction((rows: RelationRow[]) => {
        for (const row of rows) stmt.run(row);
      });
      insertMany(relations);
    });
  }

  clearRelations(filePath: string): void {
    withRetry(() => {
      this.db.prepare('DELETE FROM relations WHERE file_path = ?').run(filePath);
    });
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
    const resultMap = new Map<string, { target: string; kind: 'local_file' | 'package' | 'unresolved'; importedSymbols: string[] }>();

    const addDep = (target: string, kind: 'local_file' | 'package' | 'unresolved', symbolName: string) => {
      const key = `${kind}\x00${target}`;
      let entry = resultMap.get(key);
      if (!entry) {
        entry = { target, kind, importedSymbols: [] };
        resultMap.set(key, entry);
      }
      if (!entry.importedSymbols.includes(symbolName)) {
        entry.importedSymbols.push(symbolName);
      }
    };

    // Phase 1: imports (what this file imports, or all project imports if no filePath)
    if (direction === 'imports' || direction === 'both') {
      const params: any[] = [];
      let fileFilter = '';
      if (filePath) {
        fileFilter = 'AND r.file_path = ?';
        params.push(filePath);
      }

      const rows = this.db.prepare(`
        SELECT r.to_id, s.file_path AS target_file, s.name AS symbol_name
        FROM relations r
        LEFT JOIN symbols s ON s.id = r.to_id
        WHERE r.kind = 'imports' ${fileFilter}
      `).all(...params) as any[];

      for (const r of rows) {
        if (r.to_id.startsWith('unresolved:')) {
          addDep(r.to_id.slice('unresolved:'.length), 'unresolved', r.to_id);
        } else if (r.to_id.startsWith('package:')) {
          addDep(r.to_id.slice('package:'.length), 'package', r.to_id);
        } else if (r.target_file) {
          addDep(r.target_file, 'local_file', r.symbol_name || r.to_id);
        } else {
          addDep(r.to_id, 'local_file', r.to_id);
        }
      }
    }

    // Phase 2: imported_by (which files import from this file)
    if (filePath && (direction === 'imported_by' || direction === 'both')) {
      const rows = this.db.prepare(`
        SELECT r.file_path AS importing_file, s.name AS symbol_name
        FROM relations r
        JOIN symbols s ON s.id = r.to_id
        WHERE r.kind = 'imports' AND r.to_id IN (SELECT id FROM symbols WHERE file_path = ?)
      `).all(filePath) as any[];

      for (const r of rows) {
        addDep(r.importing_file, 'local_file', r.symbol_name || r.to_id);
      }
    }

    return Array.from(resultMap.values()).map(({ target, kind, importedSymbols }) => ({
      target,
      kind,
      importedSymbols,
      count: importedSymbols.length,
    }));
  }
}
