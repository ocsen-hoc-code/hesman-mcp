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
    const fileCount = this.db.prepare('SELECT COUNT(DISTINCT file_path) as count FROM symbols').get() as any;
    const symCount = this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as any;
    const lastTime = this.db.prepare('SELECT MAX(parsed_at) as max_time FROM file_hashes').get() as any;
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
}
