/**
 * Call-link precision (M1-09), through the real indexing pipeline. Each
 * project below is the smallest one that shows a rule:
 * - visibility: a symbol another file cannot reach is not a cross-file target;
 * - imports win: a call of an imported name is linked through that import only;
 * - member calls: `a.b()` links to a method or a property function, never to a
 *   free function or a variable named `b`;
 * - callers: a call is made by a function, a method, a class or the module,
 *   never by a plain variable.
 * Every expectation is derived from the sources written below.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { indexProject } from '../../src/indexing/index-coordinator';
import { WorkerPool } from '../../src/indexing/worker-pool';
import { SqliteStore } from '../../src/stores/sqlite';
import { moduleCallerId } from '../../src/parsers/relation-extractor';
import { defaultConfig } from '../../src/config/defaults';

const config = { ...defaultConfig, watchMode: false };

let project: string | undefined;
let store: SqliteStore | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
  if (project) rmSync(project, { recursive: true, force: true });
  project = undefined;
});

async function indexed(files: Record<string, string[]>, pool?: WorkerPool): Promise<{ root: string; db: SqliteStore }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-m109-links-')));
  for (const [path, lines] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), lines.join('\n') + '\n');
  }
  project = root;
  store = new SqliteStore(join(root, '.hesman'));
  store.open();
  const result = await indexProject(root, store, config, undefined, pool);
  expect(result.errors).toEqual([]);
  return { root, db: store };
}

/** `kind name @ file` of every linked callee of `caller` (a symbol of `callerFile`, or `<module>`), sorted. */
function calleesOf(root: string, db: SqliteStore, callerFile: string, caller: string): string[] {
  const path = join(root, callerFile);
  const fromId = caller === '<module>' ? moduleCallerId(path) : db.getSymbolsByFile(path).find((s) => s.name === caller)?.id;
  if (!fromId) throw new Error(`symbol ${caller} not indexed in ${callerFile}`);
  return db
    .getCallees(fromId)
    .map((c) => `${c.kind} ${c.name} @ ${relative(root, c.filePath)}`)
    .sort();
}

/** `name @ file` of every caller symbol of `callee` (a symbol of `calleeFile`), sorted. */
function callersOf(root: string, db: SqliteStore, calleeFile: string, callee: string): string[] {
  const to = db.getSymbolsByFile(join(root, calleeFile)).find((s) => s.name === callee);
  if (!to) throw new Error(`symbol ${callee} not indexed in ${calleeFile}`);
  return db
    .getCallers(to.id)
    .map((c) => `${c.name} @ ${relative(root, c.filePath)}`)
    .sort();
}

/** Kinds of the symbols that are the source of a `calls` relation, plus `module` for module-level calls. */
function callerKinds(root: string): string[] {
  const db = new Database(join(root, '.hesman', 'symbols.db'), { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT COALESCE(s.kind, CASE WHEN r.from_id LIKE 'module:%' THEN 'module' ELSE 'missing' END) AS kind
           FROM relations r LEFT JOIN symbols s ON s.id = r.from_id WHERE r.kind = 'calls' ORDER BY 1`,
      )
      .all() as Array<{ kind: string }>;
    return rows.map((r) => r.kind);
  } finally {
    db.close();
  }
}

describe('finding 1: a name imported from outside the project is not linked to a project symbol', () => {
  const PROJECT = {
    // A module-private helper that happens to be named like `path.join`.
    'src/cli/toml.ts': [
      "const join = (lines: string[]): string => lines.join('\\n');",
      'export function encode(lines: string[]): string {',
      '  return join(lines);',
      '}',
    ],
    'src/paths.ts': [
      "import { join } from 'node:path';",
      'export function dataDir(root: string): string {',
      "  return join(root, '.data');",
      '}',
    ],
  };

  it('`join` from `node:path` is external; the private `join` keeps its own-file caller', async () => {
    const { root, db } = await indexed(PROJECT);
    expect(calleesOf(root, db, 'src/paths.ts', 'dataDir')).toEqual([]);
    expect(calleesOf(root, db, 'src/cli/toml.ts', 'encode')).toEqual(['function join @ src/cli/toml.ts']);
    expect(callersOf(root, db, 'src/cli/toml.ts', 'join')).toEqual(['encode @ src/cli/toml.ts']);
  });

  it('gives the same links through the worker pool', async () => {
    const pool = new WorkerPool(1);
    try {
      const { root, db } = await indexed(PROJECT, pool);
      expect(calleesOf(root, db, 'src/paths.ts', 'dataDir')).toEqual([]);
      expect(callersOf(root, db, 'src/cli/toml.ts', 'join')).toEqual(['encode @ src/cli/toml.ts']);
    } finally {
      await pool.terminate();
    }
  });
});

describe('visibility: a symbol that another file cannot reach is not a cross-file target', () => {
  it('TypeScript: a function that is not exported is only linked in its own file', async () => {
    const { root, db } = await indexed({
      'src/a.ts': ['function helper(): number {', '  return 1;', '}', 'export function own(): number {', '  return helper();', '}'],
      // No import: before M1-09 the project-wide tier linked this to the only `helper` there is.
      'src/b.ts': ['export function other(): number {', '  return helper();', '}'],
    });
    expect(calleesOf(root, db, 'src/a.ts', 'own')).toEqual(['function helper @ src/a.ts']);
    expect(calleesOf(root, db, 'src/b.ts', 'other')).toEqual([]);
  });

  it('Go: a lower-case function is reachable in its package, not from another one', async () => {
    const { root, db } = await indexed({
      'go.mod': ['module example.com/shop', '', 'go 1.22'],
      'stock/clamp.go': ['package stock', 'func clamp(n int) int {', '\treturn n', '}'],
      'stock/item.go': ['package stock', 'func Restock(n int) int {', '\treturn clamp(n)', '}'],
      'report/report.go': ['package report', 'func Total(n int) int {', '\treturn clamp(n)', '}'],
    });
    expect(calleesOf(root, db, 'stock/item.go', 'Restock')).toEqual(['function clamp @ stock/clamp.go']);
    expect(calleesOf(root, db, 'report/report.go', 'Total')).toEqual([]);
  });

  it('C: a `static` function is linked from a file that includes its header, not from an unrelated file', async () => {
    const { root, db } = await indexed({
      'include/clamp.h': ['static inline int clamp(int n)', '{', '    return n;', '}'],
      'src/item.c': ['#include "clamp.h"', 'int restock(int n)', '{', '    return clamp(n);', '}'],
      'src/other.c': ['int total(int n)', '{', '    return clamp(n);', '}'],
    });
    expect(calleesOf(root, db, 'src/item.c', 'restock')).toEqual(['function clamp @ include/clamp.h']);
    expect(calleesOf(root, db, 'src/other.c', 'total')).toEqual([]);
  });
});

describe('imports win', () => {
  it('TypeScript: an imported name is linked to the imported file only, also through a re-export', async () => {
    const { root, db } = await indexed({
      'src/fmt.ts': ['export function format(value: number): string {', '  return String(value);', '}'],
      'src/index.ts': ["export { format } from './fmt.js';"],
      'src/direct.ts': ["import { format } from './fmt.js';", 'export function direct(): string {', '  return format(1);', '}'],
      'src/barrel.ts': ["import { format } from './index.js';", 'export function barrel(): string {', '  return format(2);', '}'],
      // `format` of `node:util` is not the project's `format`, although that one is exported and unique.
      'src/external.ts': ["import { format } from 'node:util';", 'export function external(): string {', "  return format('%d', 3);", '}'],
    });
    expect(calleesOf(root, db, 'src/direct.ts', 'direct')).toEqual(['function format @ src/fmt.ts']);
    expect(calleesOf(root, db, 'src/barrel.ts', 'barrel')).toEqual(['function format @ src/fmt.ts']);
    expect(calleesOf(root, db, 'src/external.ts', 'external')).toEqual([]);
  });

  it('TypeScript: a namespace import links `ns.f()` to the function of that module, and to nothing for a package', async () => {
    const { root, db } = await indexed({
      'src/fmt.ts': ['export function format(value: number): string {', '  return String(value);', '}'],
      'src/local.ts': ["import * as fmt from './fmt.js';", 'export function local(): string {', '  return fmt.format(1);', '}'],
      'src/external.ts': ["import * as util from 'node:util';", 'export function external(): string {', "  return util.format('%d', 2);", '}'],
    });
    expect(calleesOf(root, db, 'src/local.ts', 'local')).toEqual(['function format @ src/fmt.ts']);
    expect(calleesOf(root, db, 'src/external.ts', 'external')).toEqual([]);
  });

  it('TypeScript: a workspace package is a project file', async () => {
    const { root, db } = await indexed({
      'packages/utils/package.json': ['{ "name": "@acme/utils" }'],
      'packages/utils/src/clamp.ts': ['export function clamp(n: number): number {', '  return n;', '}'],
      'packages/app/package.json': ['{ "name": "@acme/app" }'],
      'packages/app/src/main.ts': ["import { clamp } from '@acme/utils';", 'export function main(): number {', '  return clamp(1);', '}'],
    });
    expect(calleesOf(root, db, 'packages/app/src/main.ts', 'main')).toEqual(['function clamp @ packages/utils/src/clamp.ts']);
  });

  it('Python: `from os.path import join` is external, `from .util import join` is the sibling module', async () => {
    const { root, db } = await indexed({
      'app/util.py': ['def join(a, b):', '    return a + b'],
      'app/external.py': ['from os.path import join', 'def external():', '    return join("a", "b")'],
      'app/local.py': ['from .util import join', 'def local():', '    return join("a", "b")'],
      'app/qualified.py': [
        'from . import util',
        'import os',
        'def qualified():',
        '    inner = os.path.join("b", "c")',
        '    return util.join("a", inner)',
      ],
    });
    expect(calleesOf(root, db, 'app/external.py', 'external')).toEqual([]);
    expect(calleesOf(root, db, 'app/local.py', 'local')).toEqual(['function join @ app/util.py']);
    expect(calleesOf(root, db, 'app/qualified.py', 'qualified')).toEqual(['function join @ app/util.py']);
  });

  it('Go: a function of the standard library is not linked to a same-named function of the package', async () => {
    const { root, db } = await indexed({
      'go.mod': ['module example.com/shop', '', 'go 1.22'],
      'util/join.go': ['package util', 'func Join(parts []string) string {', '\treturn ""', '}'],
      'cmd/main.go': [
        'package main',
        'import (',
        '\t"strings"',
        '\t"example.com/shop/util"',
        ')',
        'func external(parts []string) string {',
        '\treturn strings.Join(parts, ",")',
        '}',
        'func local(parts []string) string {',
        '\treturn util.Join(parts)',
        '}',
      ],
    });
    expect(calleesOf(root, db, 'cmd/main.go', 'external')).toEqual([]);
    expect(calleesOf(root, db, 'cmd/main.go', 'local')).toEqual(['function Join @ util/join.go']);
  });
});

describe('finding 2: a member call is not linked to a free function or a variable of the same name', () => {
  it('JavaScript: `.map(` / `.filter(` link to neither a variable `map` nor an exported function `filter`', async () => {
    const { root, db } = await indexed({
      'lib/graph.js': [
        'export function layout(items) {',
        '  const map = new Map();',
        '  return items.map((item) => map.get(item));',
        '}',
      ],
      'lib/filter.js': ['export function filter(value) {', '  return value;', '}'],
      'lib/names.js': ['export function names(list) {', '  return list.map(String).filter(Boolean);', '}'],
    });
    expect(calleesOf(root, db, 'lib/graph.js', 'layout')).toEqual([]);
    expect(calleesOf(root, db, 'lib/names.js', 'names')).toEqual([]);
  });

  it('TypeScript: a member call still links to a method; `this.x()` prefers the method of the enclosing class', async () => {
    const { root, db } = await indexed({
      'src/store.ts': [
        'export class Store {',
        '  lookup(key: string): string {',
        '    return key;',
        '  }',
        '  first(): string {',
        "    return this.read('a');",
        '  }',
        '  read(key: string): string {',
        '    return key;',
        '  }',
        '}',
      ],
      'src/cache.ts': ['export class Cache {', '  read(key: string): string {', '    return key;', '  }', '}'],
      'src/use.ts': ["import type { Store } from './store.js';", 'export function use(store: Store): string {', "  return store.lookup('a');", '}'],
    });
    expect(calleesOf(root, db, 'src/use.ts', 'use')).toEqual(['method lookup @ src/store.ts']);
    // Two classes have a method `read`: `this.read()` in `Store` is its own.
    expect(calleesOf(root, db, 'src/store.ts', 'first')).toEqual(['method read @ src/store.ts']);
  });

  it('JavaScript: a function stored as a property is linked through its object in the same file', async () => {
    const { root, db } = await indexed({
      'lib/api.js': ['const api = {};', 'api.run = function () {', '  return 1;', '};', 'export function start() {', '  return api.run();', '}'],
    });
    expect(calleesOf(root, db, 'lib/api.js', 'start')).toEqual(['function run @ lib/api.js']);
  });

  it('TypeScript: a member reached through its object is linked from another file, exported or not', async () => {
    const { root, db } = await indexed({
      // An object-literal method and a function listed in an object literal: neither is exported.
      'src/adapter.ts': [
        'export function createClient() {',
        '  const callTool = async (name: string): Promise<string> => name;',
        '  return {',
        '    callTool,',
        '    write(entry: string): string {',
        '      return entry;',
        '    },',
        '  };',
        '}',
      ],
      // Same-named methods elsewhere, not imported by the caller.
      'src/other/logger.ts': [
        'export class Logger {',
        '  write(line: string): string {',
        '    return line;',
        '  }',
        '  callTool(name: string): string {',
        '    return name;',
        '  }',
        '}',
      ],
      'src/setup.ts': [
        "import { createClient } from './adapter.js';",
        'export async function setup(): Promise<string> {',
        '  const client = createClient();',
        "  const written = client.write('entry');",
        "  return written + (await client.callTool('index_status'));",
        '}',
      ],
    });
    expect(calleesOf(root, db, 'src/setup.ts', 'setup')).toEqual([
      'function callTool @ src/adapter.ts',
      'function createClient @ src/adapter.ts',
      'method write @ src/adapter.ts',
    ]);
  });

  it('Rust: `util::clamp()` links to the function of the module the path names', async () => {
    const { root, db } = await indexed({
      'src/util.rs': ['pub fn clamp(n: i32) -> i32 {', '    n', '}'],
      'src/main.rs': ['mod util;', 'fn run(items: Vec<i32>) -> i32 {', '    items.clamp(0, 1);', '    util::clamp(1)', '}'],
    });
    // `items.clamp(..)` is a member call on a value: the free function is not its target.
    const db2 = new Database(join(root, '.hesman', 'symbols.db'), { readonly: true });
    const linked = db2
      .prepare("SELECT line FROM relations WHERE kind = 'calls' AND to_name = 'clamp' AND to_id NOT LIKE 'call:%' ORDER BY line")
      .all() as Array<{ line: number }>;
    db2.close();
    expect(linked).toEqual([{ line: 4 }]);
    expect(calleesOf(root, db, 'src/main.rs', 'run')).toEqual(['function clamp @ src/util.rs']);
  });

  it('Lua: a function of a module table is linked through the table', async () => {
    const { root, db } = await indexed({
      'inventory.lua': [
        'local M = {}',
        'function M.clamp(n)',
        '  return n',
        'end',
        'function M.restock(n)',
        '  return M.clamp(n)',
        'end',
        'return M',
      ],
    });
    expect(calleesOf(root, db, 'inventory.lua', 'restock')).toEqual(['function clamp @ inventory.lua']);
  });
});

describe('finding 3: a plain variable is never the source of a call', () => {
  it('TypeScript: module-level and test-callback calls belong to the module and stay visible as references', async () => {
    const { root, db } = await indexed({
      'src/make.ts': ['export function make(n: number): number {', '  return n;', '}'],
      'scripts/build.ts': ["import { make } from '../src/make.js';", 'const ROOT = make(1);', 'export const root = ROOT;'],
      'tests/make.test.ts': [
        "import { make } from '../src/make.js';",
        "describe('make', () => {",
        "  it('makes', () => {",
        '    const result = make(2);',
        '    expect(result).toBe(2);',
        '  });',
        '});',
      ],
    });
    expect(callerKinds(root)).toEqual(['module']);
    expect(calleesOf(root, db, 'scripts/build.ts', '<module>')).toEqual(['function make @ src/make.ts']);
    expect(calleesOf(root, db, 'tests/make.test.ts', '<module>')).toEqual(['function make @ src/make.ts']);

    // No symbol is the caller; the call sites are still references of `make`.
    expect(callersOf(root, db, 'src/make.ts', 'make')).toEqual([]);
    const make = db.getSymbolsByFile(join(root, 'src/make.ts')).find((s) => s.name === 'make')!;
    const { refs } = db.getReferences(make.id, 'calls');
    expect(refs.map((r) => `${relative(root, r.filePath)}:${r.line} ${r.callerName}`)).toEqual([
      'scripts/build.ts:2 null',
      'tests/make.test.ts:4 null',
    ]);
  });

  it('TypeScript: a local variable inside a function leaves the call to the function', async () => {
    const { root, db } = await indexed({
      'src/make.ts': ['export function make(n: number): number {', '  return n;', '}'],
      'src/run.ts': ["import { make } from './make.js';", 'export function run(): number {', '  const result = make(1);', '  return result;', '}'],
    });
    expect(callerKinds(root)).toEqual(['function']);
    expect(callersOf(root, db, 'src/make.ts', 'make')).toEqual(['run @ src/run.ts']);
  });
});
