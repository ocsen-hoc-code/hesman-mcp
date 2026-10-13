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
    expect(store.getCallTargetCandidates('onClick')).toEqual([{ id: 'P', file_path: '/p/a.ts', reach: 'file', member: true }]);
    // `exports.shared = () => ...` is reachable by a bare call after an import.
    expect(store.getCallTargetCandidates('shared')).toEqual([{ id: 'E', file_path: '/p/a.ts', member: true }]);
    // Since M1-09 every TypeScript declaration that is not exported is private to its file.
    expect(store.getCallTargetCandidates('declared')).toEqual([{ id: 'D', file_path: '/p/a.ts', reach: 'file' }]);
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
    expect(store.getCallTargetCandidates('onClick')).toEqual([{ id: 'P', file_path: '/p/a.ts', reach: 'file', member: true }]);
  });

  it('tells the resolver from where a candidate can be called: the visibility rule per language (M1-09)', () => {
    store = new SqliteStore(dir);
    store.open();
    const hidden = (id: string, file: string, language: string) => ({ ...sym(id, 'helper', 'function', file), language, is_exported: 0 });
    store.upsertSymbols([
      hidden('TS', '/p/a.ts', 'typescript'),
      hidden('TSX', '/p/a.tsx', 'tsx'),
      hidden('JS', '/p/a.js', 'javascript'),
      hidden('LUA', '/p/a.lua', 'lua'),
      hidden('SWIFT', '/p/a.swift', 'swift'),
      hidden('C', '/p/a.c', 'c'),
      hidden('CPP', '/p/a.cpp', 'cpp'),
      hidden('GO', '/p/a.go', 'go'),
      hidden('RUST', '/p/a.rs', 'rust'),
      hidden('PY', '/p/a.py', 'python'),
      hidden('JAVA', '/p/A.java', 'java'),
      { ...sym('EXPORTED', 'helper', 'function', '/p/b.ts') },
    ]);
    const reach = Object.fromEntries(store.getCallTargetCandidates('helper').map((c) => [c.id, c.reach]));
    expect(reach).toEqual({
      TS: 'file', TSX: 'file', JS: 'file', LUA: 'file', SWIFT: 'file',
      C: 'include', CPP: 'include',
      GO: 'directory',
      RUST: undefined, PY: undefined, JAVA: undefined, EXPORTED: undefined,
    });
  });

  it('tells the resolver what a member call can target: methods, class-declared functions, property functions (M1-09)', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([
      sym('CLASS', 'Box', 'class', '/p/box.kt'),
      { ...sym('METHOD', 'record', 'method', '/p/box.ts'), parent_id: 'CLASS' },
      // Kotlin and PHP tag a method as a function.
      { ...sym('INCLASS', 'restock', 'function', '/p/box.kt'), parent_id: 'CLASS' },
      { ...sym('PROPERTY', 'run', 'function', '/p/api.js'), is_property: 1 },
      sym('FREE', 'clamp', 'function', '/p/util.ts'),
      sym('VARIABLE', 'map', 'variable', '/p/graph.js'),
      // A local variable of a method is declared inside the class, and is still not a member.
      { ...sym('LOCAL', 'items', 'variable', '/p/box.ts'), parent_id: 'CLASS' },
    ]);
    expect(store.getCallTargetCandidates('record')).toEqual([
      { id: 'METHOD', file_path: '/p/box.ts', member: true, parent_id: 'CLASS', container: 'Box' },
    ]);
    expect(store.getCallTargetCandidates('restock')).toEqual([
      { id: 'INCLASS', file_path: '/p/box.kt', member: true, parent_id: 'CLASS', container: 'Box' },
    ]);
    expect(store.getCallTargetCandidates('run')).toEqual([{ id: 'PROPERTY', file_path: '/p/api.js', member: true }]);
    expect(store.getCallTargetCandidates('clamp')).toEqual([{ id: 'FREE', file_path: '/p/util.ts' }]);
    expect(store.getCallTargetCandidates('map')).toEqual([{ id: 'VARIABLE', file_path: '/p/graph.js' }]);
    expect(store.getCallTargetCandidates('items')).toEqual([
      { id: 'LOCAL', file_path: '/p/box.ts', parent_id: 'CLASS', container: 'Box' },
    ]);
    expect(store.getCallTargetCandidates('Box')).toEqual([{ id: 'CLASS', file_path: '/p/box.kt', type: true }]);
  });

  it('stores the receiver of a call and the names of an import, also in a table of an older version (M1-09)', () => {
    const db = new Database(join(dir, 'symbols.db'));
    db.exec(`CREATE TABLE relations (
      from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, file_path TEXT NOT NULL,
      line INTEGER NOT NULL, col INTEGER NOT NULL DEFAULT 0, to_name TEXT,
      PRIMARY KEY (from_id, to_id, kind, file_path, line))`);
    db.close();

    store = new SqliteStore(dir);
    store.open();
    store.upsertRelations([
      { from_id: 'A', to_id: 'call:join', to_name: 'join', kind: 'calls', file_path: '/p/a.ts', line: 3, col: 2, receiver: 'path' },
      { from_id: 'A', to_id: 'call:run', to_name: 'run', kind: 'calls', file_path: '/p/a.ts', line: 4, col: 2 },
      { from_id: 'A', to_id: 'unresolved:node:path', kind: 'imports', file_path: '/p/a.ts', line: 1, col: 0, names: '*path' },
      { from_id: 'A', to_id: 'unresolved:./setup.js', kind: 'imports', file_path: '/p/a.ts', line: 2, col: 0 },
    ]);
    expect(store.getCallRelationsToResolve().map((r) => [r.to_name, r.from_id, r.receiver])).toEqual([
      ['join', 'A', 'path'],
      ['run', 'A', null],
    ]);
    expect(store.getImports('/p/a.ts')).toEqual([
      { specifier: 'node:path', names: '*path' },
      { specifier: './setup.js', names: null },
    ]);
  });

  it('is at index schema 9: the receiver type of a call (M1-10) on top of the M1-09 link rules', () => {
    expect(INDEX_SCHEMA_VERSION).toBe(9);
  });

  it('offers a definition, not its body-less declaration, as a call target (M1-07)', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([
      { ...sym('PROTO', 'item_restock', 'function', '/p/include/inventory.h'), is_declaration: 1 },
      sym('DEF', 'item_restock', 'function', '/p/src/inventory.c'),
      { ...sym('ONLY', 'external_api', 'function', '/p/include/api.h'), is_declaration: 1 },
    ]);
    expect(store.getCallTargetCandidates('item_restock')).toEqual([{ id: 'DEF', file_path: '/p/src/inventory.c' }]);
    // A declaration whose definition is not in the project is still the best target there is.
    expect(store.getCallTargetCandidates('external_api')).toEqual([{ id: 'ONLY', file_path: '/p/include/api.h' }]);
    expect(store.getSymbolById('PROTO')?.is_declaration).toBe(1);
    expect(store.getSymbolById('DEF')?.is_declaration).toBe(0);
  });

  it('keeps every implementation when an interface method has several (no fan-out, M1-07)', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([
      { ...sym('IFACE', 'restock', 'method', '/p/Stocker.java'), is_declaration: 1 },
      sym('A', 'restock', 'method', '/p/Item.java'),
      sym('B', 'restock', 'method', '/p/Crate.java'),
    ]);
    expect(store.getCallTargetCandidates('restock').map((c) => c.id)).toEqual(['B', 'A']);
  });

  it('offers a class, not its constructors, as the target of a call to the class name (M1-07)', () => {
    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([
      { ...sym('CLASS', 'Item', 'class', '/p/Item.java'), language: 'java' },
      { ...sym('CTOR1', 'Item', 'method', '/p/Item.java'), language: 'java', parent_id: 'CLASS', start_line: 3 },
      { ...sym('CTOR2', 'Item', 'method', '/p/Item.java'), language: 'java', parent_id: 'CLASS', start_line: 6 },
      // C++: the class is declared in a header, its constructor defined in another file.
      { ...sym('CPPCLASS', 'Box', 'class', '/p/include/box.hpp'), language: 'cpp' },
      { ...sym('CPPCTOR', 'Box', 'function', '/p/src/box.cpp'), language: 'cpp' },
      // Another language's function of the same name is not a constructor of that class.
      { ...sym('PYFN', 'Box', 'function', '/p/tools/box.py'), language: 'python' },
    ]);
    expect(store.getCallTargetCandidates('Item')).toEqual([{ id: 'CLASS', file_path: '/p/Item.java', type: true }]);
    expect(store.getCallTargetCandidates('Box').map((c) => c.id)).toEqual(['CPPCLASS', 'PYFN']);
  });

  it('adds is_declaration to a symbols table created by an older version (M1-07)', () => {
    const db = new Database(join(dir, 'symbols.db'));
    db.exec(`CREATE TABLE symbols (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, start_col INTEGER NOT NULL DEFAULT 0,
      end_col INTEGER NOT NULL DEFAULT 0, signature TEXT, doc_comment TEXT, parent_id TEXT,
      language TEXT NOT NULL, is_exported INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
      is_property INTEGER NOT NULL DEFAULT 0)`);
    db.close();

    store = new SqliteStore(dir);
    store.open();
    store.upsertSymbols([
      { ...sym('PROTO', 'f', 'function', '/p/a.h'), is_declaration: 1 },
      sym('DEF', 'f', 'function', '/p/a.c'),
    ]);
    expect(store.getCallTargetCandidates('f')).toEqual([{ id: 'DEF', file_path: '/p/a.c' }]);
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

describe('call-chain queries use the relation indexes', () => {
  it('looks callers and callees up by id, never through the kind index or a symbols scan', async () => {
    const { CALLERS_SQL, CALLEES_SQL } = await import('../../../src/stores/sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'hesman-plan-'));
    const store = new SqliteStore(dir);
    store.open();
    store.close();
    const db = new Database(join(dir, 'symbols.db'), { readonly: true });
    try {
      for (const [sql, index] of [[CALLERS_SQL, '(to_id=?)'], [CALLEES_SQL, '(from_id=?)']] as const) {
        const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x', 1, 50) as Array<{ detail: string }>).map((r) => r.detail).join('\n');
        expect(plan, plan).toContain(index);
        expect(plan, plan).not.toContain('idx_relations_kind');
        expect(plan, plan).not.toMatch(/SCAN s\b/);
      }
    } finally {
      db.close();
    }
  });
});
