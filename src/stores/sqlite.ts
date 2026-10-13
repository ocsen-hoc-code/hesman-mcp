import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
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
  /** 1 for a function assigned to an object key or property (stored as 0 when absent). */
  is_property?: number;
  /** 1 for a function or method declared without a body (stored as 0 when absent). */
  is_declaration?: number;
  updated_at: number;
}

/** A symbol a call may be linked to. Optional fields are absent when they do not apply. */
export interface CallTargetCandidate {
  id: string;
  file_path: string;
  /**
   * From where the symbol can be called when that is not the whole project
   * (see `CALL_REACH`): `file` — its own file only; `include` — also a file
   * that imports its file; `directory` — the files of its directory.
   */
  reach?: 'file' | 'include' | 'directory';
  /**
   * What `receiver.name()` can call: a method, a function declared in a class
   * or interface (some grammars tag methods as functions), or a function
   * stored as an object key or property.
   */
  member?: true;
  /** A class: `ns.Name(...)` / `new ns.Name(...)` constructs it. */
  type?: true;
  /** Id of the class, interface or namespace the symbol is declared in. */
  parent_id?: string;
  /** Name of that container. */
  container?: string;
}

/**
 * Visibility rule of the call resolver, per language, for a symbol whose
 * `is_exported` is 0 (the language's own export rule, see the profiles):
 *
 * - `file`: TypeScript, TSX and JavaScript (a module-private declaration),
 *   Lua (`local`), Swift (`private` / `fileprivate`). Nothing outside the file
 *   can name the symbol.
 * - `include`: C and C++ (`static`, an anonymous namespace, a private member).
 *   The symbol has no external linkage, but a file that includes its header
 *   compiles it (`static inline` helpers, inline private methods).
 * - `directory`: Go. A lower-case identifier is visible in its package, and a
 *   package is a directory.
 *
 * Every other language keeps project-wide reach: Rust items without `pub`
 * are visible in their crate; Java, C#, Kotlin and PHP record `public` only,
 * which says nothing about package or module visibility; Python, Ruby and
 * Bash have no enforced privacy. A function stored as a property that is not
 * exported has `file` reach in every language (M1-08).
 */
const CALL_REACH: ReadonlyMap<string, 'file' | 'include' | 'directory'> = new Map([
  ['typescript', 'file'],
  ['tsx', 'file'],
  ['javascript', 'file'],
  ['lua', 'file'],
  ['swift', 'file'],
  ['c', 'include'],
  ['cpp', 'include'],
  ['go', 'directory'],
]);

export interface RelationRow {
  from_id: string;
  to_id: string;
  kind: string;
  file_path: string;
  line: number;
  col: number;
  /** Callee name of a `calls` relation (resolved into `to_id` after indexing). */
  to_name?: string | null;
  /** Receiver of a `calls` relation: null for `f()`, the receiver's last name for `a.f()`, `*` when it has none. */
  receiver?: string | null;
  /** Declared type of the receiver of a `calls` relation, when the file declares it (see `receiver-types.ts`). */
  receiverType?: string | null;
  /** Names bound by an `imports` relation, space separated; a module name is prefixed with `*`. */
  names?: string | null;
}

/**
 * A file indexed by the text tier (no grammar): no symbols, only line-range
 * chunks. The chunks themselves are not stored here — their ids are derived
 * from `file_path` and `chunk_count` (`textChunkIds` in `parsers/text-chunker.ts`)
 * and their text lives in the vector store.
 */
export interface TextFileRow {
  file_path: string;
  /** Text-tier language label (`parsers/text-languages.ts`), e.g. "sql" or "text". */
  language: string;
  line_count: number;
  chunk_count: number;
  updated_at: number;
}

/** A `calls` relation awaiting (re-)resolution of its target. */
export interface CallRelationToResolve {
  rowid: number;
  file_path: string;
  to_name: string;
  to_id: string;
  /** The symbol (or `module:<file>`) that makes the call. */
  from_id: string;
  /** See `RelationRow.receiver`. */
  receiver: string | null;
  /** See `RelationRow.receiverType`. */
  receiver_type: string | null;
}

/** An import of a file: the module specifier and the names it binds (see `RelationRow.names`). */
export interface StoredImport {
  specifier: string;
  names: string | null;
}

/** Kinds a call can never target (`foo(` is not a call of an interface or type). */
const NON_CALLABLE_KINDS = ['interface', 'type', 'enum', 'namespace'];
/** Kinds that declare a type a receiver can be declared with (M1-10). */
const TYPE_DECLARATION_KINDS: ReadonlySet<string> = new Set(['class', 'interface', 'type', 'enum']);
/** The kind of a symbol that `Name(...)` / `new Name(...)` instantiates. */
const CLASS_KIND = 'class';
const METHOD_KIND = 'method';
const FUNCTION_KIND = 'function';
/** Kinds whose callables are members. */
const TYPE_KINDS: ReadonlySet<string> = new Set(['class', 'interface']);

/** SQLite caps bound parameters; stay well below the limit. */
const IN_CHUNK = 500;

function chunked<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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
 *   2 — `calls` relations carry the callee name (`to_name`) and are resolved
 *       across files after indexing; no declaration self-calls (M0-13).
 *   3 — files without a grammar are indexed by the text tier (`text_files`,
 *       text chunks in the vector store); older indexes never saw them (M1-04).
 *   4 — symbols come from tags queries: some kinds, and therefore ids, differ
 *       and more definitions are indexed (M1-02).
 *   5 — `.tsx` and `.js`/`.jsx`/`.mjs`/`.cjs` files are parsed by their own
 *       grammars and stored as `tsx` / `javascript`, not `typescript`; files of
 *       the other bundled languages move from the text tier to symbols (M1-05).
 *   6 — extraction fixes (M1-08): `is_exported` follows the module's real
 *       exports, multi-line signatures, Python tuple assignments, no calls
 *       from strings/comments/signatures, `is_property` on symbols.
 *   7 — calls and imports come from the syntax tree (M1-07): other call
 *       relations for every language, calls for C, C++, Ruby and Bash, imports
 *       for Python, Go, C, C++ and Ruby, `is_declaration` on symbols.
 *   8 — call-link precision (M1-09): a call is made by a function, method,
 *       class or the module (`module:<file>`), never by a plain variable;
 *       calls carry their `receiver` and imports the `names` they bind; other
 *       links (visibility, imports, member calls).
 *   9 — call-link by receiver type (M1-10): a call records the declared type of
 *       its receiver (`receiver_type`); a member call on a type of the project
 *       links to that type's members, on a built-in or external type it does not
 *       link, and an unknown receiver links only in its own file, an imported
 *       file or its directory.
 */
export const INDEX_SCHEMA_VERSION = 9;

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
    updated_at  INTEGER NOT NULL,
    is_property INTEGER NOT NULL DEFAULT 0,
    is_declaration INTEGER NOT NULL DEFAULT 0
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
  `CREATE TABLE IF NOT EXISTS text_files (
    file_path   TEXT PRIMARY KEY,
    language    TEXT NOT NULL,
    line_count  INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_text_files_lang ON text_files(language)`,
  `CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

/** Name of the database file inside the data directory. */
const DB_FILE = 'symbols.db';
/** A database and the files SQLite keeps next to it in WAL mode. */
const DB_FILE_SUFFIXES = ['', '-wal', '-shm'];
/** Inserted after the database file name of a damaged database that was moved aside. */
const CORRUPT_MARK = '.corrupt';

/**
 * True if SQLite reports that the database file itself is damaged
 * (`SQLITE_CORRUPT`, also from a virtual table: `SQLITE_CORRUPT_VTAB`) or is
 * not a database at all (`SQLITE_NOTADB`). The index is derived data, so the
 * answer to these is to rebuild it (`SqliteStore.rebuild`), not to fail.
 */
export function isCorruptDatabaseError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && (code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_CORRUPT'));
}

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

  /**
   * Opens (or creates) the database. A file that SQLite reports as corrupt is
   * moved aside and replaced by an empty database (see `rebuild`); any other
   * failure is thrown.
   */
  open(): void {
    mkdirSync(this.dataDir, { recursive: true });
    try {
      this.openDatabase();
    } catch (err) {
      if (!isCorruptDatabaseError(err)) throw err;
      this.rebuild(err);
    }
    log.info({ dbPath: join(this.dataDir, DB_FILE) }, 'SQLite store opened');
  }

  private openDatabase(): void {
    this.db = new Database(join(this.dataDir, DB_FILE));
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.runMigrations();
      this.ensureFtsTriggers();
    } catch (err) {
      this.db.close();
      throw err;
    }
  }

  /**
   * Replaces a damaged database by an empty one. The damaged files are moved
   * aside as `symbols.db.corrupt` (`-wal`, `-shm`) rather than deleted, so
   * they can still be inspected; only one such generation is kept, so repeated
   * damage cannot fill the disk. Nothing else in the data directory is touched.
   *
   * The empty database has index schema version 0, so the next `indexProject`
   * indexes every file again, and it records the vector documents as
   * outdated: they were written for the damaged index and are cleared by the
   * next run that has the vector store.
   *
   * @param reason - the error that showed the damage, for the log line
   */
  rebuild(reason: unknown): void {
    const dbPath = join(this.dataDir, DB_FILE);
    const movedTo = `${dbPath}${CORRUPT_MARK}`;
    try {
      if (this.db?.open) this.db.close();
    } catch {
      // A damaged database may not close cleanly; its files are moved either way.
    }
    for (const suffix of DB_FILE_SUFFIXES) {
      rmSync(`${movedTo}${suffix}`, { force: true });
      if (existsSync(`${dbPath}${suffix}`)) renameSync(`${dbPath}${suffix}`, `${movedTo}${suffix}`);
    }
    log.warn(
      { dbPath, movedTo, error: reason instanceof Error ? reason.message : String(reason) },
      'The index database is damaged: it was moved aside and the index is rebuilt from the project files',
    );
    this.openDatabase();
    this.setVectorSchemaVersion(0);
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
    // `to_name` was added in index schema 2; older databases lack the column.
    const columns = this.db.prepare('PRAGMA table_info(relations)').all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'to_name')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN to_name TEXT');
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_relations_to_name ON relations(to_name)');
    // `receiver` and `names` were added in index schema 8.
    if (!columns.some((c) => c.name === 'receiver')) this.db.exec('ALTER TABLE relations ADD COLUMN receiver TEXT');
    if (!columns.some((c) => c.name === 'names')) this.db.exec('ALTER TABLE relations ADD COLUMN names TEXT');
    // `receiver_type` was added in index schema 9.
    if (!columns.some((c) => c.name === 'receiver_type')) this.db.exec('ALTER TABLE relations ADD COLUMN receiver_type TEXT');
    // Relations are replaced, and imports read, one file at a time (M1-09 stores more of them).
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_relations_file ON relations(file_path, kind)');
    // `is_property` was added in index schema 6; older databases lack the column.
    const symbolColumns = this.db.prepare('PRAGMA table_info(symbols)').all() as Array<{ name: string }>;
    if (!symbolColumns.some((c) => c.name === 'is_property')) {
      this.db.exec('ALTER TABLE symbols ADD COLUMN is_property INTEGER NOT NULL DEFAULT 0');
    }
    // `is_declaration` was added in index schema 7.
    if (!symbolColumns.some((c) => c.name === 'is_declaration')) {
      this.db.exec('ALTER TABLE symbols ADD COLUMN is_declaration INTEGER NOT NULL DEFAULT 0');
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

  /** Drop every symbol, relation, text file and file hash so the next index run starts from scratch. */
  clearIndex(): void {
    withRetry(() => {
      this.db.transaction(() => {
        this.db.exec('DELETE FROM symbols; DELETE FROM relations; DELETE FROM text_files; DELETE FROM file_hashes;');
      })();
    });
  }

  upsertSymbols(symbols: SymbolRow[]): void {
    withRetry(() => {
      if (symbols.length === 0) return;
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO symbols
          (id, name, kind, file_path, start_line, end_line, start_col, end_col, signature, doc_comment, parent_id, language, is_exported, is_property, is_declaration, updated_at)
        VALUES
          (@id, @name, @kind, @file_path, @start_line, @end_line, @start_col, @end_col, @signature, @doc_comment, @parent_id, @language, @is_exported, @is_property, @is_declaration, @updated_at)
      `);
      const insertMany = this.db.transaction((rows: SymbolRow[]) => {
        for (const row of rows) stmt.run({ ...row, is_property: row.is_property ?? 0, is_declaration: row.is_declaration ?? 0 });
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

  /** Records (or replaces) a file indexed by the text tier. */
  upsertTextFile(row: Omit<TextFileRow, 'updated_at'> & { updated_at?: number }): void {
    withRetry(() => {
      this.db.prepare(
        `INSERT OR REPLACE INTO text_files (file_path, language, line_count, chunk_count, updated_at)
         VALUES (@file_path, @language, @line_count, @chunk_count, @updated_at)`,
      ).run({ ...row, updated_at: row.updated_at ?? Date.now() });
    });
  }

  /** The text-tier record of a file, or `undefined` when the file is not indexed as text. */
  getTextFile(filePath: string): TextFileRow | undefined {
    return this.db.prepare('SELECT * FROM text_files WHERE file_path = ?').get(filePath) as TextFileRow | undefined;
  }

  clearTextFile(filePath: string): void {
    withRetry(() => {
      this.db.prepare('DELETE FROM text_files WHERE file_path = ?').run(filePath);
    });
  }

  /** Files and chunks indexed by the text tier. */
  getTextStats(): { files: number; chunks: number } {
    return this.db.prepare(
      'SELECT COUNT(*) AS files, COALESCE(SUM(chunk_count), 0) AS chunks FROM text_files',
    ).get() as { files: number; chunks: number };
  }

  /** Text-tier files and chunks per language label, most files first (ties by name). */
  getTextLanguageStats(): Array<{ language: string; files: number; chunks: number }> {
    return this.db.prepare(
      `SELECT language, COUNT(*) AS files, COALESCE(SUM(chunk_count), 0) AS chunks
       FROM text_files GROUP BY language ORDER BY files DESC, language ASC`,
    ).all() as Array<{ language: string; files: number; chunks: number }>;
  }

  upsertFileHash(filePath: string, sha256: string): void {
    withRetry(() => {
      this.db.prepare('INSERT OR REPLACE INTO file_hashes (file_path, sha256, parsed_at) VALUES (?, ?, ?)').run(filePath, sha256, Date.now());
    });
  }

  deleteFileHash(filePath: string): void {
    withRetry(() => {
      this.db.prepare('DELETE FROM file_hashes WHERE file_path = ?').run(filePath);
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
        `INSERT OR REPLACE INTO relations (from_id, to_id, kind, file_path, line, col, to_name, receiver, receiver_type, names)
         VALUES (@from_id, @to_id, @kind, @file_path, @line, @col, @to_name, @receiver, @receiver_type, @names)`,
      );
      const insertMany = this.db.transaction((rows: RelationRow[]) => {
        for (const row of rows) {
          stmt.run({
            from_id: row.from_id,
            to_id: row.to_id,
            kind: row.kind,
            file_path: row.file_path,
            line: row.line,
            col: row.col,
            to_name: row.to_name ?? null,
            receiver: row.receiver ?? null,
            receiver_type: row.receiverType ?? null,
            names: row.names ?? null,
          });
        }
      });
      insertMany(relations);
    });
  }

  /**
   * `calls` relations whose target must be (re-)resolved. Without a scope:
   * all of them. With a scope: those made in `files`, plus those whose callee
   * name is in `names` (the set of candidate symbols for that name changed).
   */
  getCallRelationsToResolve(scope?: { files: string[]; names: string[] }): CallRelationToResolve[] {
    const base = 'SELECT rowid, file_path, to_name, to_id, from_id, receiver, receiver_type FROM relations WHERE kind = \'calls\' AND to_name IS NOT NULL';
    if (!scope) {
      return this.db.prepare(`${base} ORDER BY rowid`).all() as CallRelationToResolve[];
    }
    const rows = new Map<number, CallRelationToResolve>();
    const collect = (column: 'file_path' | 'to_name', values: string[]): void => {
      for (const part of chunked([...new Set(values)])) {
        const sql = `${base} AND ${column} IN (${part.map(() => '?').join(',')})`;
        for (const row of this.db.prepare(sql).all(...part) as CallRelationToResolve[]) rows.set(row.rowid, row);
      }
    };
    collect('file_path', scope.files);
    collect('to_name', scope.names);
    return [...rows.values()].sort((a, b) => a.rowid - b.rowid);
  }

  /**
   * What the project says a receiver's declared type name is (M1-10):
   * `type` when a class, interface, type or enum of that name exists;
   * `symbol` when only other symbols have it (a function a constructor call
   * was made of, a variable); `external` when nothing in the project has it
   * (`Map`, `dict`, a third-party class).
   */
  typeKindOf(name: string): 'type' | 'symbol' | 'external' {
    const rows = this.db.prepare('SELECT DISTINCT kind FROM symbols WHERE name = ?').all(name) as Array<{ kind: string }>;
    if (rows.length === 0) return 'external';
    return rows.some((r) => TYPE_DECLARATION_KINDS.has(r.kind)) ? 'type' : 'symbol';
  }

  /**
   * The names of the types that the types named `name` extend or implement,
   * transitively and nearest first, up to a few levels. Only the relations
   * the extractor stores (both declarations in one file) are followed.
   */
  supertypeNames(name: string, maxDepth = 3): string[] {
    const stmt = this.db.prepare(
      `SELECT DISTINCT p.name AS name FROM symbols c
         JOIN relations r ON r.from_id = c.id AND r.kind IN ('extends', 'implements')
         JOIN symbols p ON p.id = r.to_id
        WHERE c.name = ?`,
    );
    const found: string[] = [];
    const seen = new Set<string>([name]);
    let level = [name];
    for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
      const next: string[] = [];
      for (const current of level) {
        for (const row of stmt.all(current) as Array<{ name: string }>) {
          if (seen.has(row.name)) continue;
          seen.add(row.name);
          found.push(row.name);
          next.push(row.name);
        }
      }
      level = next;
    }
    return found;
  }

  /**
   * Symbols named `name` that a call can target, ordered by file and line,
   * with what the resolver needs to know about each (`CallTargetCandidate`).
   * Besides the kinds that are never called (interfaces, types, …), two rules
   * remove same-named symbols that are not separate targets:
   *
   * - Constructors: when a class named `name` exists, a function or method of
   *   the same name in the same language is its constructor (`Item(int n)` in
   *   Java/C#, `Item::Item()` in C++). `new Item(...)` is linked to the class,
   *   which is unique, where its constructors may be overloaded.
   * - Declarations: a callable without a body (a C/C++ prototype, an interface,
   *   abstract or trait method) is dropped when a same-named callable with a
   *   body exists, so the call is linked to the implementation. With no
   *   definition in the project the declaration stays the target; several
   *   implementations stay several candidates (the resolver never fans out).
   */
  getCallTargetCandidates(name: string): CallTargetCandidate[] {
    const placeholders = NON_CALLABLE_KINDS.map(() => '?').join(',');
    let rows = this.db.prepare(
      `SELECT s.id, s.file_path, s.kind, s.language, s.is_declaration AS declared, s.is_exported AS exported,
              s.is_property AS property, s.parent_id, p.name AS container, p.kind AS container_kind
         FROM symbols s LEFT JOIN symbols p ON p.id = s.parent_id
        WHERE s.name = ? AND s.kind NOT IN (${placeholders}) ORDER BY s.file_path, s.start_line`,
    ).all(name, ...NON_CALLABLE_KINDS) as Array<{
      id: string;
      file_path: string;
      kind: string;
      language: string;
      declared: number;
      exported: number;
      property: number;
      parent_id: string | null;
      container: string | null;
      container_kind: string | null;
    }>;
    if (rows.length > 1) {
      const classLanguages = new Set(rows.filter((r) => r.kind === CLASS_KIND).map((r) => r.language));
      if (classLanguages.size > 0) rows = rows.filter((r) => r.kind === CLASS_KIND || !classLanguages.has(r.language));
      if (rows.some((r) => !r.declared)) rows = rows.filter((r) => !r.declared);
    }
    return rows.map((r) => {
      const candidate: CallTargetCandidate = { id: r.id, file_path: r.file_path };
      const reach = r.exported ? undefined : r.property ? 'file' : CALL_REACH.get(r.language);
      if (reach) candidate.reach = reach;
      const inType = r.kind === FUNCTION_KIND && r.container_kind !== null && TYPE_KINDS.has(r.container_kind);
      if (r.kind === METHOD_KIND || r.property || inType) candidate.member = true;
      if (r.kind === CLASS_KIND) candidate.type = true;
      if (r.parent_id) candidate.parent_id = r.parent_id;
      if (r.container) candidate.container = r.container;
      return candidate;
    });
  }

  /** The imports of `filePath`, in the order they were stored. */
  getImports(filePath: string): StoredImport[] {
    const rows = this.db.prepare(
      'SELECT to_id, names FROM relations WHERE kind = \'imports\' AND file_path = ? AND to_id LIKE \'unresolved:%\' ORDER BY line, rowid',
    ).all(filePath) as Array<{ to_id: string; names: string | null }>;
    return rows.map((r) => ({ specifier: r.to_id.slice('unresolved:'.length), names: r.names }));
  }

  /** Module specifiers imported by `filePath` (e.g. `./greet.js`). */
  getImportSpecifiers(filePath: string): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT to_id FROM relations WHERE kind = \'imports\' AND file_path = ? AND to_id LIKE \'unresolved:%\'',
    ).all(filePath) as Array<{ to_id: string }>;
    return rows.map((r) => r.to_id.slice('unresolved:'.length));
  }

  /** Points relations (by rowid) at new targets. */
  setRelationTargets(updates: Array<{ rowid: number; to_id: string }>): void {
    withRetry(() => {
      if (updates.length === 0) return;
      // OR REPLACE: a duplicate (same caller, target and line) collapses into one row.
      const stmt = this.db.prepare('UPDATE OR REPLACE relations SET to_id = ? WHERE rowid = ?');
      this.db.transaction(() => {
        for (const u of updates) stmt.run(u.to_id, u.rowid);
      })();
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

  /** Every text-tier file with its label and chunk count (M1-06: to recognise the id of a text chunk). */
  getTextFiles(): Array<Pick<TextFileRow, 'file_path' | 'language' | 'chunk_count'>> {
    return this.db.prepare('SELECT file_path, language, chunk_count FROM text_files').all() as Array<
      Pick<TextFileRow, 'file_path' | 'language' | 'chunk_count'>
    >;
  }
}
