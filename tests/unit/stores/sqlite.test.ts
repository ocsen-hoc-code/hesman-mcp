import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore, type SymbolRow } from '../../../src/stores/sqlite';
import { rmSync, mkdirSync, existsSync } from 'node:fs';

const TEST_DIR = '.hesman-test';

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new SqliteStore(TEST_DIR);
    store.open();
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  const makeSymbol = (overrides: Partial<SymbolRow> = {}): SymbolRow => ({
    id: 'abc123',
    name: 'myFunction',
    kind: 'function',
    file_path: 'src/index.ts',
    start_line: 10,
    end_line: 20,
    start_col: 0,
    end_col: 1,
    signature: 'function myFunction(a: string): void',
    doc_comment: '/** My function */',
    parent_id: null,
    language: 'typescript',
    is_exported: 1,
    updated_at: Date.now(),
    ...overrides,
  });

  it('creates tables on open', () => {
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map((t: { name: string }) => t.name);
    expect(names).toContain('symbols');
    expect(names).toContain('file_hashes');
  });

  it('inserts and retrieves symbols by name', () => {
    store.upsertSymbols([makeSymbol({ id: 's1', name: 'foo', file_path: 'a.ts' })]);
    store.upsertSymbols([makeSymbol({ id: 's2', name: 'foo', file_path: 'b.ts' })]);

    const results = store.getSymbolsByName('foo');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.file_path).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('returns empty array for unknown symbol name', () => {
    const results = store.getSymbolsByName('nonexistent');
    expect(results).toHaveLength(0);
  });

  it('retrieves symbols by file', () => {
    store.upsertSymbols([
      makeSymbol({ id: 's1', name: 'foo', file_path: 'src/a.ts' }),
      makeSymbol({ id: 's2', name: 'bar', file_path: 'src/a.ts' }),
      makeSymbol({ id: 's3', name: 'baz', file_path: 'src/b.ts' }),
    ]);

    const results = store.getSymbolsByFile('src/a.ts');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name).sort()).toEqual(['bar', 'foo']);
  });

  it('clears symbols for a file', () => {
    store.upsertSymbols([
      makeSymbol({ id: 's1', file_path: 'src/a.ts' }),
      makeSymbol({ id: 's2', file_path: 'src/b.ts' }),
    ]);
    store.clearSymbols('src/a.ts');

    expect(store.getSymbolsByFile('src/a.ts')).toHaveLength(0);
    expect(store.getSymbolsByFile('src/b.ts')).toHaveLength(1);
  });

  it('upsert replaces existing symbol with same id', () => {
    store.upsertSymbols([makeSymbol({ id: 's1', name: 'oldName' })]);
    store.upsertSymbols([makeSymbol({ id: 's1', name: 'newName' })]);

    const results = store.getSymbolsByName('newName');
    expect(results).toHaveLength(1);
    expect(store.getSymbolsByName('oldName')).toHaveLength(0);
  });

  it('tracks file hashes', () => {
    store.upsertFileHash('src/a.ts', 'abc123');
    expect(store.getFileHash('src/a.ts')).toBe('abc123');
    expect(store.getFileHash('nonexistent.ts')).toBeNull();

    store.upsertFileHash('src/a.ts', 'def456');
    expect(store.getFileHash('src/a.ts')).toBe('def456');
  });

  it('returns stats', () => {
    store.upsertSymbols([
      makeSymbol({ id: 's1', file_path: 'a.ts' }),
      makeSymbol({ id: 's2', file_path: 'a.ts' }),
      makeSymbol({ id: 's3', file_path: 'b.ts' }),
    ]);

    const stats = store.getStats();
    expect(stats.totalFiles).toBe(2);
    expect(stats.totalSymbols).toBe(3);
  });
});
