import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { INDEX_SCHEMA_VERSION, SqliteStore } from '../../../src/stores/sqlite';

const sym = (id: string, name: string, kind: string, file_path: string) => ({
  id, name, kind, file_path, start_line: 1, end_line: 2, start_col: 0, end_col: 0,
  signature: null, doc_comment: null, parent_id: null, language: 'typescript', is_exported: 1, updated_at: 0,
});

describe('SqliteStore call targets', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-call-targets-'));
  });

  afterEach(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('bumps the index schema version for the new relations column', () => {
    expect(INDEX_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('adds to_name to a relations table created by an older version', () => {
    const db = new Database(join(dir, 'symbols.db'));
    db.exec(`CREATE TABLE relations (
      from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, file_path TEXT NOT NULL,
      line INTEGER NOT NULL, col INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (from_id, to_id, kind, file_path, line))`);
    db.close();

    store = new SqliteStore(dir);
    store.open();
    store.upsertRelations([{ from_id: 'a', to_id: 'call:b', to_name: 'b', kind: 'calls', file_path: '/p/a.ts', line: 3, col: 0 }]);
    expect(store.getCallRelationsToResolve().map((r) => r.to_name)).toEqual(['b']);
  });

  it('lists call relations by changed file or callee name, and updates their targets', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([sym('A', 'a', 'function', '/p/a.ts'), sym('B', 'b', 'function', '/p/b.ts')]);
    store.upsertRelations([
      { from_id: 'A', to_id: 'call:b', to_name: 'b', kind: 'calls', file_path: '/p/a.ts', line: 2, col: 2 },
      { from_id: 'A', to_id: 'call:c', to_name: 'c', kind: 'calls', file_path: '/p/a.ts', line: 3, col: 2 },
      { from_id: 'B', to_id: 'call:z', to_name: 'z', kind: 'calls', file_path: '/p/b.ts', line: 2, col: 2 },
    ]);

    const byName = store.getCallRelationsToResolve({ files: [], names: ['b'] });
    expect(byName.map((r) => r.to_name)).toEqual(['b']);
    const byFile = store.getCallRelationsToResolve({ files: ['/p/b.ts'], names: [] });
    expect(byFile.map((r) => r.to_name)).toEqual(['z']);

    store.setRelationTargets([{ rowid: byName[0].rowid, to_id: 'B' }]);
    expect(store.getCallers('B').map((c) => c.name)).toEqual(['a']);
  });

  it('offers only callable kinds as call targets', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([
      sym('F', 'thing', 'function', '/p/a.ts'),
      sym('I', 'thing', 'interface', '/p/b.ts'),
      sym('T', 'thing', 'type', '/p/c.ts'),
    ]);
    expect(store.getCallTargetCandidates('thing')).toEqual([{ id: 'F', file_path: '/p/a.ts' }]);
  });

  it('marks a non-exported property-assigned function as a same-file-only call target (M1-08)', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([
      { ...sym('P', 'onClick', 'function', '/p/a.ts'), is_property: 1, is_exported: 0 },
      { ...sym('E', 'shared', 'function', '/p/a.ts'), is_property: 1, is_exported: 1 },
      { ...sym('D', 'declared', 'function', '/p/a.ts'), is_exported: 0 },
    ]);
    expect(store.getCallTargetCandidates('onClick')).toEqual([{ id: 'P', file_path: '/p/a.ts', same_file_only: true }]);
    // `exports.shared = () => ...` is reachable by a bare call after an import.
    expect(store.getCallTargetCandidates('shared')).toEqual([{ id: 'E', file_path: '/p/a.ts' }]);
    expect(store.getCallTargetCandidates('declared')).toEqual([{ id: 'D', file_path: '/p/a.ts' }]);
    expect(store.getSymbolById('P')?.is_property).toBe(1);
    expect(store.getSymbolById('D')?.is_property).toBe(0);
  });

  it('adds is_property to a symbols table created by an older version (M1-08)', () => {
    const db = new Database(join(dir, 'symbols.db'));
    db.exec(`CREATE TABLE symbols (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, start_col INTEGER NOT NULL DEFAULT 0,
      end_col INTEGER NOT NULL DEFAULT 0, signature TEXT, doc_comment TEXT, parent_id TEXT,
      language TEXT NOT NULL, is_exported INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`);
    db.close();

    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([{ ...sym('P', 'onClick', 'function', '/p/a.ts'), is_property: 1, is_exported: 0 }]);
    expect(store.getCallTargetCandidates('onClick')).toEqual([{ id: 'P', file_path: '/p/a.ts', same_file_only: true }]);
  });

  it('lists the import specifiers of a file', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertRelations([
      { from_id: 'A', to_id: 'unresolved:./greet.js', kind: 'imports', file_path: '/p/main.ts', line: 1, col: 0 },
    ]);
    expect(store.getImportSpecifiers('/p/main.ts')).toEqual(['./greet.js']);
  });
});
