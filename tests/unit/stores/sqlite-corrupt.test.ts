/**
 * A corrupt `symbols.db` is derived data that can be rebuilt (M1-09): the
 * store moves the damaged files aside and starts empty; the read-only reader
 * of the dashboard only reports the problem. Every database here lives in a
 * temp directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { INDEX_SCHEMA_VERSION, SqliteStore, isCorruptDatabaseError } from '../../../src/stores/sqlite';
import { indexProject } from '../../../src/indexing/index-coordinator';
import { IndexUnavailableError, openReadOnlyIndex } from '../../../src/ui/server/index-reader';
import { defaultConfig } from '../../../src/config/defaults';

const GARBAGE = 'this is not a database\n'.repeat(400);
const sym = (id: string, name: string) => ({
  id, name, kind: 'function', file_path: '/p/a.ts', start_line: 1, end_line: 2, start_col: 0, end_col: 0,
  signature: null, doc_comment: null, parent_id: null, language: 'typescript', is_exported: 1, updated_at: 0,
});

describe('SqliteStore: a corrupt database (M1-09)', () => {
  let dir: string;
  let store: SqliteStore | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-corrupt-store-'));
  });

  afterEach(() => {
    store?.close();
    store = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('recognizes the errors SQLite raises for a damaged file, and no other', () => {
    expect(isCorruptDatabaseError(Object.assign(new Error('x'), { code: 'SQLITE_CORRUPT' }))).toBe(true);
    expect(isCorruptDatabaseError(Object.assign(new Error('x'), { code: 'SQLITE_CORRUPT_VTAB' }))).toBe(true);
    expect(isCorruptDatabaseError(Object.assign(new Error('x'), { code: 'SQLITE_NOTADB' }))).toBe(true);
    expect(isCorruptDatabaseError(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }))).toBe(false);
    expect(isCorruptDatabaseError(Object.assign(new Error('x'), { code: 'SQLITE_READONLY' }))).toBe(false);
    expect(isCorruptDatabaseError(new Error('database disk image is malformed'))).toBe(false);
    expect(isCorruptDatabaseError(undefined)).toBe(false);
  });

  it('open() moves a file that is not a database aside and starts with an empty index', () => {
    writeFileSync(join(dir, 'symbols.db'), GARBAGE);
    writeFileSync(join(dir, 'tool-calls.jsonl'), '{}\n');

    store = new SqliteStore(dir);
    store.open();

    expect(store.getStats().totalSymbols).toBe(0);
    store.upsertSymbols([sym('A', 'a')]);
    expect(store.getSymbolById('A')?.name).toBe('a');
    expect(readFileSync(join(dir, 'symbols.db.corrupt'), 'utf-8')).toBe(GARBAGE);
    // Nothing else in the data directory is touched.
    expect(readFileSync(join(dir, 'tool-calls.jsonl'), 'utf-8')).toBe('{}\n');
  });

  it('keeps one damaged generation: a second recovery replaces the first copy', () => {
    writeFileSync(join(dir, 'symbols.db'), 'first damaged file');
    store = new SqliteStore(dir);
    store.open();
    store.close();
    writeFileSync(join(dir, 'symbols.db'), 'second damaged file');
    rmSync(join(dir, 'symbols.db-wal'), { force: true });
    rmSync(join(dir, 'symbols.db-shm'), { force: true });
    store = new SqliteStore(dir);
    store.open();

    expect(readFileSync(join(dir, 'symbols.db.corrupt'), 'utf-8')).toBe('second damaged file');
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt')).sort()).toEqual(['symbols.db.corrupt']);
  });

  it('rebuild() replaces an open database whose damage shows up later', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([sym('A', 'a')]);
    store.setIndexSchemaVersion(INDEX_SCHEMA_VERSION);

    store.rebuild(new Error('database disk image is malformed'));

    expect(store.getStats().totalSymbols).toBe(0);
    expect(store.getIndexSchemaVersion()).toBe(0);
    expect(existsSync(join(dir, 'symbols.db.corrupt'))).toBe(true);
    // The vectors written for the damaged index are stale: recorded as outdated.
    expect(store.getVectorSchemaVersion()).toBe(0);
  });

  it('does not treat other failures as corruption', () => {
    // The data directory is a file: opening must fail, and nothing is moved.
    const file = join(dir, 'not-a-directory');
    writeFileSync(file, 'x');
    const broken = new SqliteStore(file);
    expect(() => broken.open()).toThrow();
    expect(readdirSync(dir)).toEqual(['not-a-directory']);
  });
});

describe('indexProject: a corrupt index is rebuilt (M1-09)', () => {
  let root: string;
  let store: SqliteStore | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hesman-corrupt-index-'));
    writeFileSync(join(root, 'a.ts'), 'export function alpha(): number {\n  return 1;\n}\n');
  });

  afterEach(() => {
    store?.close();
    store = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  it('a damaged table found while an outdated index is cleared: the index is rebuilt and its vectors are marked outdated', async () => {
    const dataDir = join(root, '.hesman');
    store = new SqliteStore(dataDir);
    store.open();
    const config = { ...defaultConfig, watchMode: false };
    await indexProject(root, store, config);
    expect(store.getSymbolsByName('alpha')).toHaveLength(1);
    store.close();

    const db = new Database(join(dataDir, 'symbols.db'));
    db.unsafeMode(true); // shadow tables of a virtual table are write-protected otherwise
    db.exec("UPDATE symbols_fts_data SET block = x'00'");
    db.prepare("UPDATE metadata SET value = '1' WHERE key = 'index_schema_version'").run();
    db.close();

    store = new SqliteStore(dataDir);
    store.open();
    const result = await indexProject(root, store, config);

    expect(result.errors).toEqual([]);
    expect(result.filesIndexed).toBe(1);
    expect(store.getSymbolsByName('alpha')).toHaveLength(1);
    expect(store.getIndexSchemaVersion()).toBe(INDEX_SCHEMA_VERSION);
    expect(existsSync(join(dataDir, 'symbols.db.corrupt'))).toBe(true);
    // This run had no vector store: the next run that has one must clear and re-embed.
    expect(store.getVectorSchemaVersion()).toBeLessThan(INDEX_SCHEMA_VERSION);
  });
});

describe('the dashboard reader stays read-only on a corrupt index (M1-09)', () => {
  it('reports the problem and leaves the file where it is', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hesman-corrupt-ui-'));
    try {
      writeFileSync(join(dir, 'symbols.db'), GARBAGE);
      expect(() => openReadOnlyIndex(dir)).toThrow(IndexUnavailableError);
      expect(() => openReadOnlyIndex(dir)).toThrow(/hesman index/);
      expect(readFileSync(join(dir, 'symbols.db'), 'utf-8')).toBe(GARBAGE);
      expect(readdirSync(dir)).toEqual(['symbols.db']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
