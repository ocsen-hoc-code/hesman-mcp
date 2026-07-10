import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore, type RelationRow } from '../../../src/stores/sqlite';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const TEST_DIR = '.hesman-test-relations';

describe('SqliteStore — relations', () => {
  let store: SqliteStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new SqliteStore(TEST_DIR);
    store.open();
    // Insert test symbols so foreign-key-like lookups work
    store.upsertSymbols([
      { id: 'a', name: 'main', kind: 'function', file_path: 'src/a.ts', start_line: 1, end_line: 5, start_col: 0, end_col: 10, signature: null, doc_comment: null, parent_id: null, language: 'typescript', is_exported: 1, updated_at: Date.now() },
      { id: 'b', name: 'helper', kind: 'function', file_path: 'src/a.ts', start_line: 7, end_line: 10, start_col: 0, end_col: 10, signature: null, doc_comment: null, parent_id: null, language: 'typescript', is_exported: 0, updated_at: Date.now() },
      { id: 'c', name: 'util', kind: 'function', file_path: 'src/b.ts', start_line: 1, end_line: 3, start_col: 0, end_col: 10, signature: null, doc_comment: null, parent_id: null, language: 'typescript', is_exported: 1, updated_at: Date.now() },
    ]);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('creates relations table on open', () => {
    const db = (store as any).db;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    const names = tables.map((t: any) => t.name);
    expect(names).toContain('relations');
  });

  it('inserts and retrieves relations', () => {
    store.upsertRelations([
      { from_id: 'a', to_id: 'b', kind: 'calls', file_path: 'src/a.ts', line: 3, col: 4 },
      { from_id: 'b', to_id: 'c', kind: 'calls', file_path: 'src/a.ts', line: 8, col: 4 },
    ]);
    expect(store.getTotalRelations()).toBe(2);
  });

  it('getReferences returns all references to a symbol', () => {
    store.upsertRelations([
      { from_id: 'a', to_id: 'b', kind: 'calls', file_path: 'src/a.ts', line: 3, col: 4 },
      { from_id: 'c', to_id: 'b', kind: 'calls', file_path: 'src/b.ts', line: 2, col: 2 },
    ]);
    const result = store.getReferences('b');
    expect(result.refs).toHaveLength(2);
    expect(result.totalCount).toBe(2);
  });

  it('getReferences filters by kind', () => {
    store.upsertRelations([
      { from_id: 'a', to_id: 'b', kind: 'calls', file_path: 'src/a.ts', line: 3, col: 4 },
      { from_id: 'a', to_id: 'b', kind: 'references', file_path: 'src/a.ts', line: 1, col: 10 },
    ]);
    const result = store.getReferences('b', 'calls');
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].kind).toBe('calls');
  });

  it('getCallers returns direct callers at depth 1', () => {
    store.upsertRelations([
      { from_id: 'a', to_id: 'b', kind: 'calls', file_path: 'src/a.ts', line: 3, col: 4 },
    ]);
    const callers = store.getCallers('b', 1, 50);
    expect(callers).toHaveLength(1);
    expect(callers[0].symbolId).toBe('a');
    expect(callers[0].depth).toBe(1);
  });

  it('getCallers returns transitive callers at depth 2', () => {
    store.upsertRelations([
      { from_id: 'a', to_id: 'b', kind: 'calls', file_path: 'src/a.ts', line: 3, col: 4 },
      { from_id: 'b', to_id: 'c', kind: 'calls', file_path: 'src/a.ts', line: 8, col: 4 },
    ]);
    const callers = store.getCallers('c', 2, 50);
    expect(callers.length).toBeGreaterThanOrEqual(2);
    const depths = callers.map(c => c.depth);
    expect(depths).toContain(1); // b → c (direct)
    expect(depths).toContain(2); // a → b → c (transitive)
  });

  it('getCallees returns direct callees', () => {
    store.upsertRelations([
      { from_id: 'a', to_id: 'b', kind: 'calls', file_path: 'src/a.ts', line: 3, col: 4 },
    ]);
    const callees = store.getCallees('a', 1, 50);
    expect(callees).toHaveLength(1);
    expect(callees[0].symbolId).toBe('b');
  });

  it('getDependencies returns imports for a file', () => {
    store.upsertRelations([
      { from_id: 'a', to_id: 'c', kind: 'imports', file_path: 'src/a.ts', line: 0, col: 0 },
    ]);
    const deps = store.getDependencies('src/a.ts');
    expect(deps).toHaveLength(1);
    expect(deps[0].target).toBe('c');
  });

  it('clearRelations removes relations for a file', () => {
    store.upsertRelations([
      { from_id: 'a', to_id: 'b', kind: 'calls', file_path: 'src/a.ts', line: 3, col: 4 },
      { from_id: 'c', to_id: 'b', kind: 'calls', file_path: 'src/b.ts', line: 2, col: 2 },
    ]);
    store.clearRelations('src/a.ts');
    expect(store.getTotalRelations()).toBe(1);
  });

  it('getReferences supports pagination via cursor', () => {
    const rels: RelationRow[] = [];
    for (let i = 0; i < 5; i++) {
      rels.push({ from_id: 'a', to_id: 'b', kind: 'calls', file_path: `src/f${i}.ts`, line: i, col: 0 });
    }
    store.upsertRelations(rels);

    const page1 = store.getReferences('b', undefined, 2);
    expect(page1.refs).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = store.getReferences('b', undefined, 2, page1.nextCursor!);
    expect(page2.refs).toHaveLength(2);
    expect(page2.hasMore).toBe(true);
    expect(page2.nextCursor).toBeTruthy();

    const page3 = store.getReferences('b', undefined, 2, page2.nextCursor!);
    expect(page3.refs).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });
});
