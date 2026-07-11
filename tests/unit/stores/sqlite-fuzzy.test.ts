import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../../src/stores/sqlite';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const TEST_DIR = '.hesman-test-fuzzy';

describe('SqliteStore — FTS5 fuzzy search', () => {
  let store: SqliteStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new SqliteStore(TEST_DIR);
    store.open();
    store.upsertSymbols([
      { id: 'a', name: 'addNumbers', kind: 'function', file_path: 'src/a.ts', start_line: 1, end_line: 5, start_col: 0, end_col: 10, signature: 'function addNumbers(a: number, b: number): number', doc_comment: null, parent_id: null, language: 'typescript', is_exported: 1, updated_at: Date.now() },
      { id: 'b', name: 'addUsers', kind: 'function', file_path: 'src/a.ts', start_line: 7, end_line: 10, start_col: 0, end_col: 10, signature: null, doc_comment: null, parent_id: null, language: 'typescript', is_exported: 0, updated_at: Date.now() },
      { id: 'c', name: 'deleteUser', kind: 'function', file_path: 'src/b.ts', start_line: 1, end_line: 3, start_col: 0, end_col: 10, signature: null, doc_comment: null, parent_id: null, language: 'typescript', is_exported: 1, updated_at: Date.now() },
      { id: 'd', name: 'getUserList', kind: 'function', file_path: 'src/b.ts', start_line: 5, end_line: 8, start_col: 0, end_col: 10, signature: null, doc_comment: null, parent_id: null, language: 'typescript', is_exported: 0, updated_at: Date.now() },
    ]);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('exact match returns only matching symbol', () => {
    const results = store.getSymbolsByName('addNumbers', undefined, undefined, 10, 'exact');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('addNumbers');
  });

  it('prefix match returns symbols starting with query', () => {
    const results = store.getSymbolsByName('add', undefined, undefined, 10, 'prefix');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((s: { name: string }) => s.name.startsWith('add'))).toBe(true);
  });

  it('fuzzy match returns relevant results via FTS5', () => {
    const results = store.getSymbolsByName('add', undefined, undefined, 10, 'fuzzy');
    expect(results.length).toBeGreaterThan(0);
    // FTS5 rank column should be present
    expect(results[0]).toHaveProperty('rank');
  });

  it('fuzzy match with kind filter', () => {
    const results = store.getSymbolsByName('user', 'function', undefined, 10, 'fuzzy');
    expect(results.every((s: { kind: string }) => s.kind === 'function')).toBe(true);
  });

  it('fuzzy match returns empty for no match', () => {
    const results = store.getSymbolsByName('xyznonexistent', undefined, undefined, 10, 'fuzzy');
    expect(results).toHaveLength(0);
  });

  it('FTS5 syncs after symbol delete', () => {
    store.clearSymbols('src/a.ts');
    const results = store.getSymbolsByName('addNumbers', undefined, undefined, 10, 'fuzzy');
    expect(results).toHaveLength(0);
  });
});
