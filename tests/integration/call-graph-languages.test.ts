/**
 * Call resolution rules of M1-07, through the real indexing pipeline:
 * - a body-less declaration (C/C++ prototype, interface/abstract/protocol
 *   method) does not compete with its definition: the call links to the
 *   definition;
 * - `new X(...)` links to the class X, not to one of its constructors;
 * - imports of Python, Go, C and Ruby files pick the imported definition among
 *   same-named ones.
 * Every expectation is derived from the sources written below.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { indexProject } from '../../src/indexing/index-coordinator';
import { WorkerPool } from '../../src/indexing/worker-pool';
import { SqliteStore } from '../../src/stores/sqlite';
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

function createProject(files: Record<string, string[]>): { root: string; store: SqliteStore } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-m107-graph-')));
  for (const [path, lines] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), lines.join('\n') + '\n');
  }
  project = root;
  store = new SqliteStore(join(root, '.hesman'));
  store.open();
  return { root, store };
}

/** `kind name @ file` of every callee of the symbol `caller` defined in `callerFile`, sorted. */
function calleesOf(root: string, db: SqliteStore, callerFile: string, caller: string): string[] {
  const from = db.getSymbolsByFile(join(root, callerFile)).find((s) => s.name === caller);
  if (!from) throw new Error(`symbol ${caller} not indexed in ${callerFile}`);
  return db
    .getCallees(from.id)
    .map((c) => `${c.kind} ${c.name} @ ${relative(root, c.filePath)}`)
    .sort();
}

describe('declarations do not compete with definitions', () => {
  const C_PROJECT = {
    'include/inventory.h': ['int item_restock(int amount);', 'int external_api(int amount);'],
    'src/inventory.c': ['#include "inventory.h"', 'int item_restock(int amount)', '{', '    return amount;', '}'],
    'app/report.c': [
      '#include "inventory.h"',
      'int report(int amount)',
      '{',
      '    return item_restock(amount) + external_api(amount);',
      '}',
    ],
  };

  it('C: a call links to the definition, not to the prototype in the header', async () => {
    const { root, store: db } = createProject(C_PROJECT);
    await indexProject(root, db, config);
    // `external_api` has no definition in the project: its prototype is the only target there is.
    expect(calleesOf(root, db, 'app/report.c', 'report')).toEqual([
      'function external_api @ include/inventory.h',
      'function item_restock @ src/inventory.c',
    ]);
  });

  it('C: the same links come out of the worker pool and survive re-indexing the caller', async () => {
    const { root, store: db } = createProject(C_PROJECT);
    const pool = new WorkerPool(1);
    try {
      await indexProject(root, db, config, undefined, pool);
      const expected = ['function external_api @ include/inventory.h', 'function item_restock @ src/inventory.c'];
      expect(calleesOf(root, db, 'app/report.c', 'report')).toEqual(expected);

      const caller = join(root, 'app/report.c');
      writeFileSync(caller, `\n${readFileSync(caller, 'utf-8')}`);
      const again = await indexProject(root, db, config, undefined, pool);
      expect(again.filesIndexed).toBe(1);
      expect(calleesOf(root, db, 'app/report.c', 'report')).toEqual(expected);
    } finally {
      await pool.terminate();
    }
  });

  it('C: a definition added later takes the call over from the prototype', async () => {
    const { root, store: db } = createProject(C_PROJECT);
    await indexProject(root, db, config);
    mkdirSync(join(root, 'vendor'));
    writeFileSync(join(root, 'vendor', 'api.c'), 'int external_api(int amount)\n{\n    return amount;\n}\n');
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'app/report.c', 'report')).toEqual([
      'function external_api @ vendor/api.c',
      'function item_restock @ src/inventory.c',
    ]);
  });

  it('C++: member calls link to the out-of-class definition, `new Item` to the class', async () => {
    const { root, store: db } = createProject({
      'include/item.hpp': ['class Item {', 'public:', '    explicit Item(int count);', '    int restock(int amount);', '};'],
      'src/item.cpp': [
        '#include "item.hpp"',
        'Item::Item(int count) {}',
        'int Item::restock(int amount) {',
        '    return amount;',
        '}',
      ],
      'app/main.cpp': ['#include "item.hpp"', 'int run() {', '    Item* item = new Item(1);', '    return item->restock(2);', '}'],
    });
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'app/main.cpp', 'run')).toEqual(['class Item @ include/item.hpp', 'method restock @ src/item.cpp']);
  });

  it('Java: an interface method does not block the call to its implementation; `new Item` links to the class', async () => {
    const { root, store: db } = createProject({
      'api/Stocker.java': ['interface Stocker {', '    int restock(int amount);', '}'],
      'model/Item.java': [
        'public class Item implements Stocker {',
        '    public Item(int count) {}',
        '    public Item(int count, String name) {}',
        '    public int restock(int amount) { return amount; }',
        '}',
      ],
      'app/App.java': ['class App {', '    int run() {', '        Stocker item = new Item(1);', '        return item.restock(2);', '    }', '}'],
    });
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'app/App.java', 'run')).toEqual(['class Item @ model/Item.java', 'method restock @ model/Item.java']);
  });

  it('C#: an interface method does not block the call to its implementation; `new Item` links to the class', async () => {
    const { root, store: db } = createProject({
      'Api/IStocker.cs': ['interface IStocker {', '    int Restock(int amount);', '}'],
      'Model/Item.cs': ['public class Item : IStocker {', '    public Item(int count) {}', '    public int Restock(int amount) { return amount; }', '}'],
      'App/App.cs': ['class App {', '    int Run() {', '        IStocker item = new Item(1);', '        return item.Restock(2);', '    }', '}'],
    });
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'App/App.cs', 'Run')).toEqual(['class Item @ Model/Item.cs', 'method Restock @ Model/Item.cs']);
  });

  it.each([
    [
      'Kotlin',
      {
        'api/Stocker.kt': ['interface Stocker {', '    fun restock(amount: Int): Int', '}'],
        'model/Item.kt': ['class Item : Stocker {', '    override fun restock(amount: Int): Int { return amount }', '}'],
        'app/App.kt': ['fun run(item: Stocker): Int {', '    return item.restock(2)', '}'],
      },
      'app/App.kt',
      'model/Item.kt',
    ],
    [
      'Swift',
      {
        'api/Stocker.swift': ['protocol Stocker {', '    func restock(amount: Int) -> Int', '}'],
        'model/Item.swift': ['struct Item: Stocker {', '    func restock(amount: Int) -> Int { return amount }', '}'],
        'app/App.swift': ['func run(item: Stocker) -> Int {', '    return item.restock(amount: 2)', '}'],
      },
      'app/App.swift',
      'model/Item.swift',
    ],
    [
      'PHP',
      {
        'api/Stocker.php': ['<?php', 'interface Stocker {', '    public function restock(int $amount): int;', '}'],
        'model/Item.php': ['<?php', 'class Item implements Stocker {', '    public function restock(int $amount): int { return $amount; }', '}'],
        'app/App.php': ['<?php', 'function run(Stocker $item): int {', '    return $item->restock(2);', '}'],
      },
      'app/App.php',
      'model/Item.php',
    ],
    [
      'Rust',
      {
        'api/stocker.rs': ['pub trait Stocker {', '    fn restock(&mut self, amount: i32) -> i32;', '}'],
        'model/item.rs': ['impl Stocker for Item {', '    fn restock(&mut self, amount: i32) -> i32 { amount }', '}'],
        'app/app.rs': ['pub fn run(item: &mut dyn Stocker) -> i32 {', '    item.restock(2)', '}'],
      },
      'app/app.rs',
      'model/item.rs',
    ],
    [
      'Go',
      {
        'api/stocker.go': ['package api', '', 'type Stocker interface {', '\tRestock(amount int) int', '}'],
        'model/item.go': ['package model', '', 'func (i *Item) Restock(amount int) int { return amount }'],
        'app/app.go': ['package app', '', 'func Run(item Stocker) int {', '\treturn item.Restock(2)', '}'],
      },
      'app/app.go',
      'model/item.go',
    ],
    [
      'TypeScript',
      {
        'api/stocker.ts': ['export interface Stocker {', '  restock(amount: number): number;', '}'],
        'model/item.ts': ['export class Item implements Stocker {', '  restock(amount: number): number { return amount; }', '}'],
        'app/app.ts': ['export function run(item: Stocker): number {', '  return item.restock(2);', '}'],
      },
      'app/app.ts',
      'model/item.ts',
    ],
  ] as const)('%s: a call to an interface method links to its only implementation', async (_language, files, callerFile, implFile) => {
    const { root, store: db } = createProject(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [...v]])));
    await indexProject(root, db, config);
    const caller = callerFile.endsWith('.go') ? 'Run' : 'run';
    const callees = calleesOf(root, db, callerFile, caller).filter((c) => /restock/i.test(c));
    expect(callees).toHaveLength(1);
    expect(callees[0]).toMatch(new RegExp(` @ ${implFile.replace('.', '\\.')}$`));
  });

  it('Java: two implementations of an interface method stay unresolved (no fan-out)', async () => {
    const { root, store: db } = createProject({
      'api/Stocker.java': ['interface Stocker {', '    int restock(int amount);', '}'],
      'model/Item.java': ['class Item implements Stocker {', '    public int restock(int amount) { return amount; }', '}'],
      'model/Crate.java': ['class Crate implements Stocker {', '    public int restock(int amount) { return amount; }', '}'],
      'app/App.java': ['class App {', '    int run(Stocker item) {', '        return item.restock(2);', '    }', '}'],
    });
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'app/App.java', 'run')).toEqual([]);
  });
});

describe('imports choose among same-named definitions', () => {
  it('Python: `from pkg.util import helper` links to that module, not to another `helper`', async () => {
    const { root, store: db } = createProject({
      'src/pkg/util.py': ['def helper(value):', '    return value'],
      'tools/util.py': ['def helper(value):', '    return value'],
      'app/main.py': ['from pkg.util import helper', '', '', 'def run(value):', '    return helper(value)'],
      'app/relative.py': ['from ..tools.util import helper', '', '', 'def run_relative(value):', '    return helper(value)'],
    });
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'app/main.py', 'run')).toEqual(['function helper @ src/pkg/util.py']);
    expect(calleesOf(root, db, 'app/relative.py', 'run_relative')).toEqual(['function helper @ tools/util.py']);
  });

  it('Go: an imported package of the module links, another package with the same function does not', async () => {
    const { root, store: db } = createProject({
      'go.mod': ['module example.com/shop', '', 'go 1.22'],
      'internal/util/clamp.go': ['package util', '', 'func Clamp(v int) int { return v }'],
      'legacy/util/clamp.go': ['package util', '', 'func Clamp(v int) int { return v }'],
      'cmd/app/main.go': [
        'package main',
        '',
        'import (',
        '\t"fmt"',
        '',
        '\t"example.com/shop/internal/util"',
        ')',
        '',
        'func run(v int) int {',
        '\tfmt.Println(v)',
        '\treturn util.Clamp(v)',
        '}',
      ],
    });
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'cmd/app/main.go', 'run')).toEqual(['function Clamp @ internal/util/clamp.go']);
  });

  it('C: `#include "a/util.h"` links to the definition behind that header', async () => {
    const { root, store: db } = createProject({
      'a/util.h': ['int clamp(int value);'],
      'a/util.c': ['#include "util.h"', 'int clamp(int value)', '{', '    return value;', '}'],
      'b/util.c': ['int clamp(int value)', '{', '    return value;', '}'],
      'app/main.c': ['#include "../a/util.h"', 'int run(int value)', '{', '    return clamp(value);', '}'],
    });
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'app/main.c', 'run')).toEqual(['function clamp @ a/util.c']);
  });

  it('Ruby: `require_relative` links to the required file', async () => {
    const { root, store: db } = createProject({
      'lib/a/util.rb': ['def normalize(name)', '  name.strip', 'end'],
      'lib/b/util.rb': ['def normalize(name)', '  name.strip', 'end'],
      'app/main.rb': ["require_relative '../lib/a/util'", '', 'def run(name)', '  normalize(name)', 'end'],
    });
    await indexProject(root, db, config);
    expect(calleesOf(root, db, 'app/main.rb', 'run')).toEqual(['method normalize @ lib/a/util.rb']);
  });

  it('keeps `list_dependencies` data: an import is stored as `unresolved:<specifier>` on its line', async () => {
    const { root, store: db } = createProject({
      'app/main.py': ['import os', 'from pkg.util import helper', '', '', 'def run(value):', '    return helper(value)'],
    });
    await indexProject(root, db, config);
    expect(db.getImportSpecifiers(join(root, 'app/main.py')).sort()).toEqual(['os', 'pkg.util']);
  });
});
