/**
 * What extraction records about a call and an import so that the resolver can
 * link precisely (M1-09): who makes the call, whether it has a receiver, and
 * which names an import binds. Every expectation is derived from the source
 * text written in the test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../../../src/parsers/core';
import { extractRelations, moduleCallerId } from '../../../src/parsers/relation-extractor';
import { languageForPath, profileFor } from '../../../src/parsers/languages';

let dir: string;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hesman-m109-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Extraction {
  /** `caller->callee`, in source order; a call outside every function has the caller `<module>`. */
  calls: string[];
  /** `callee` → receiver as recorded (`undefined` when the call has none). */
  receivers: Record<string, string | undefined>;
  /** `specifier` → names bound by the import, as recorded. */
  imports: Record<string, string | undefined>;
  /** Kinds of the symbols that are the source of a call. */
  callerKinds: Set<string>;
}

async function extract(ext: string, lines: string[]): Promise<Extraction> {
  const path = join(dir, `case${counter++}${ext}`);
  const source = lines.join('\n') + '\n';
  writeFileSync(path, source);
  const profile = profileFor(languageForPath(path) ?? '');
  if (!profile) throw new Error(`no language for ${ext}`);
  const result = await parseFile(path, profile);
  const byId = new Map(result.symbols.map((s) => [s.id, s]));
  const relations = extractRelations(result.symbols, source, path, profile, result.references);
  const calls = relations.filter((r) => r.kind === 'calls').sort((a, b) => a.line - b.line || a.col - b.col);
  const callerName = (id: string): string => (id === moduleCallerId(path) ? '<module>' : (byId.get(id)?.name ?? `?${id}`));
  return {
    calls: calls.map((c) => `${callerName(c.from_id)}->${c.to_name}`),
    receivers: Object.fromEntries(calls.map((c) => [c.to_name, c.receiver ?? undefined])),
    imports: Object.fromEntries(
      relations.filter((r) => r.kind === 'imports').map((r) => [r.to_id.replace(/^unresolved:/, ''), r.names ?? undefined]),
    ),
    callerKinds: new Set(calls.map((c) => byId.get(c.from_id)?.kind ?? 'module')),
  };
}

describe('the source of a call (M1-09)', () => {
  it('TypeScript: a call in the initializer of a module-level constant belongs to the module, not to the constant', async () => {
    const { calls, callerKinds } = await extract('.ts', [
      "import { fileURLToPath } from 'node:url';",
      "const ROOT = fileURLToPath(new URL('.', import.meta.url));",
      'export function root(): string {',
      '  return ROOT;',
      '}',
    ]);
    expect(calls).toEqual(['<module>->fileURLToPath', '<module>->URL']);
    expect(callerKinds).toEqual(new Set(['module']));
  });

  it('TypeScript: a call in the initializer of a local variable belongs to the enclosing function', async () => {
    const { calls } = await extract('.ts', [
      'export async function run(): Promise<number> {',
      '  const result = await indexProject(1);',
      '  return result;',
      '}',
    ]);
    expect(calls).toEqual(['run->indexProject']);
  });

  it('TypeScript: a variable whose value is a function is a caller; a callback without a name is not', async () => {
    const { calls } = await extract('.ts', [
      'export const load = async (): Promise<number> => fetchAll(1);',
      "describe('suite', () => {",
      "  it('case', async () => {",
      '    const result = await indexProject(1);',
      '    expect(result).toBe(1);',
      '  });',
      '});',
    ]);
    expect(calls).toEqual([
      'load->fetchAll',
      '<module>->describe',
      '<module>->it',
      '<module>->indexProject',
      '<module>->expect',
      '<module>->toBe',
    ]);
  });

  it('TypeScript: a call in a class member initializer belongs to the class', async () => {
    const { calls, callerKinds } = await extract('.ts', [
      'export class Registry {',
      '  private readonly items = createItems();',
      '  size(): number {',
      '    return count(this.items);',
      '  }',
      '}',
    ]);
    expect(calls).toEqual(['Registry->createItems', 'size->count']);
    expect(callerKinds).toEqual(new Set(['class', 'method']));
  });

  it('Python: a module-level call belongs to the module; a lambda bound to a name is a caller', async () => {
    const { calls } = await extract('.py', [
      'LIMIT = compute_limit()',
      'double = lambda n: scale(n, 2)',
      'def main():',
      '    total = add(1, 2)',
      '    return total',
      'main()',
    ]);
    expect(calls).toEqual(['<module>->compute_limit', 'double->scale', 'main->add', '<module>->main']);
  });

  it('Go: a call in a package-level variable initializer belongs to the module', async () => {
    const { calls } = await extract('.go', [
      'package shop',
      'var limit = computeLimit()',
      'func Run() int {',
      '\tcount := load()',
      '\treturn count',
      '}',
    ]);
    expect(calls).toEqual(['<module>->computeLimit', 'Run->load']);
  });

  it('Bash: a command at the top level of a script belongs to the module', async () => {
    const { calls } = await extract('.sh', ['build() {', '  compile src', '}', 'build']);
    expect(calls).toEqual(['build->compile', '<module>->build']);
  });
});

describe('the receiver of a call (M1-09)', () => {
  it('TypeScript: member, optional, chained, `this` and plain calls', async () => {
    const { receivers } = await extract('.ts', [
      'export class Box {',
      '  run(items: string[], other: Box | undefined): void {',
      '    plain(1);',
      '    items.map(String);',
      '    other?.optional();',
      '    this.own();',
      '    this.store.nested();',
      '    make().chained();',
      '    new Box();',
      '    new ns.Scoped();',
      '  }',
      '}',
    ]);
    expect(receivers).toEqual({
      plain: undefined,
      map: 'items',
      optional: 'other',
      own: 'this',
      nested: 'store',
      make: undefined,
      chained: '*',
      Box: undefined,
      Scoped: 'ns',
    });
  });

  it('Python: `self`, `super()`, a module and a plain call', async () => {
    const { receivers } = await extract('.py', [
      'class Item(Base):',
      '    def run(self):',
      '        self.own()',
      '        super().inherited()',
      '        util.helper()',
      '        plain()',
    ]);
    expect(receivers).toEqual({ own: 'self', inherited: 'super', helper: 'util', plain: undefined });
  });

  it('Go: a package or value selector is a receiver', async () => {
    const { receivers } = await extract('.go', [
      'package shop',
      'func Run(s *Store) int {',
      '\ts.Close()',
      '\treturn util.Clamp(local())',
      '}',
    ]);
    expect(receivers).toEqual({ Close: 's', Clamp: 'util', local: undefined });
  });

  it('Rust: a path, a field and `self`', async () => {
    const { receivers } = await extract('.rs', [
      'impl Item {',
      '    fn run(&self) -> i32 {',
      '        self.own();',
      '        util::clamp(plain())',
      '    }',
      '}',
    ]);
    expect(receivers).toEqual({ own: 'self', clamp: 'util', plain: undefined });
  });

  it('C: `->` and `.` are receivers', async () => {
    const { receivers } = await extract('.c', [
      'int run(struct ops *ops, struct item item) {',
      '  ops->restock(1);',
      '  item.audit(2);',
      '  return plain(3);',
      '}',
    ]);
    expect(receivers).toEqual({ restock: 'ops', audit: 'item', plain: undefined });
  });

  it('C++: `::`, `->` and templates', async () => {
    const { receivers } = await extract('.cpp', [
      'int run(Item* item) {',
      '  item->record(1);',
      '  util::clamp(2);',
      '  util::make<Item>(3);',
      '  return plain(4);',
      '}',
    ]);
    expect(receivers).toEqual({ record: 'item', clamp: 'util', make: 'util', plain: undefined });
  });

  it('Java: an object, `this` and a plain call', async () => {
    const { receivers } = await extract('.java', [
      'class Box {',
      '  int run(Item item) {',
      '    item.record(1);',
      '    this.own();',
      '    return plain(2);',
      '  }',
      '}',
    ]);
    expect(receivers).toEqual({ record: 'item', own: 'this', plain: undefined });
  });

  it('C#: member access and null-conditional access', async () => {
    const { receivers } = await extract('.cs', [
      'class Box {',
      '  int Run(Item item) {',
      '    item.Record(1);',
      '    item?.Audit(2);',
      '    return Plain(3);',
      '  }',
      '}',
    ]);
    expect(receivers).toEqual({ Record: 'item', Audit: 'item', Plain: undefined });
  });

  it('PHP: `->`, `?->`, `::` and a plain call', async () => {
    const { receivers } = await extract('.php', [
      '<?php',
      'class Box {',
      '  function run($item) {',
      '    $this->own();',
      '    $item?->audit();',
      '    Util::clamp(1);',
      '    return plain(2);',
      '  }',
      '}',
    ]);
    expect(receivers).toEqual({ own: '$this', audit: '$item', clamp: 'Util', plain: undefined });
  });

  it('Ruby: an explicit receiver, `self` and a plain call', async () => {
    const { receivers } = await extract('.rb', [
      'class Box',
      '  def run(item)',
      '    item.record(1)',
      '    self.own(2)',
      '    plain(3)',
      '  end',
      'end',
    ]);
    expect(receivers).toEqual({ record: 'item', own: 'self', plain: undefined });
  });

  it('Kotlin and Swift: a navigation suffix is a receiver', async () => {
    const kotlin = await extract('.kt', ['fun run(item: Item): Int {', '    item.record(1)', '    return plain(2)', '}']);
    expect(kotlin.receivers).toEqual({ record: 'item', plain: undefined });
    const swift = await extract('.swift', ['func run(item: Item) -> Int {', '    item.record(1)', '    return plain(2)', '}']);
    expect(swift.receivers).toEqual({ record: 'item', plain: undefined });
  });

  it('Lua: `.` and `:` are receivers', async () => {
    const { receivers } = await extract('.lua', ['function run(item)', '  item:record(1)', '  util.clamp(2)', '  return plain(3)', 'end']);
    expect(receivers).toEqual({ record: 'item', clamp: 'util', plain: undefined });
  });

  it('Bash: a variable assignment before a command is not a receiver', async () => {
    const { receivers } = await extract('.sh', ['run() {', '  MODE=fast compile src', '}']);
    expect(receivers).toEqual({ compile: undefined });
  });
});

describe('the names an import binds (M1-09)', () => {
  it('TypeScript: named, aliased, default and namespace imports; a bare import binds nothing', async () => {
    const { imports } = await extract('.ts', [
      "import { join, resolve as abs } from 'node:path';",
      "import fs from 'node:fs';",
      "import * as os from 'node:os';",
      "import type { Stats } from './stats.js';",
      "import './setup.js';",
      'export const here = (): string => join(abs(os.homedir()), String(fs.constants.F_OK));',
    ]);
    expect(imports).toEqual({
      'node:path': 'join abs',
      'node:fs': 'fs',
      'node:os': '*os',
      './stats.js': 'Stats',
      './setup.js': undefined,
    });
  });

  it('JavaScript: `require` bound to a name or destructured', async () => {
    const { imports } = await extract('.js', [
      "const path = require('node:path');",
      "const { clamp, scale: grow } = require('./util');",
      'module.exports = () => path.join(clamp(1), grow(2));',
    ]);
    expect(imports).toEqual({ 'node:path': 'path', './util': 'clamp grow' });
  });

  it('Python: `from` imports bind names, `import` binds a module', async () => {
    const { imports } = await extract('.py', [
      'from os.path import join, dirname as parent',
      'from . import sibling',
      'import pkg.util',
      'import numpy as np',
      'def run():',
      '    return join(parent("a"), sibling.f(), pkg.util.g(), np.zeros(1))',
    ]);
    expect(imports).toEqual({ 'os.path': 'join parent', '.': 'sibling', 'pkg.util': '*util', numpy: '*np' });
  });

  it('Go: an import binds its alias', async () => {
    const { imports } = await extract('.go', [
      'package main',
      'import (',
      '\t"fmt"',
      '\tu "example.com/shop/util"',
      ')',
      'func main() { fmt.Println(u.Clamp(1)) }',
    ]);
    expect(imports).toEqual({ fmt: undefined, 'example.com/shop/util': '*u' });
  });
});
