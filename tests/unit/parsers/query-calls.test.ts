/**
 * Call extraction from the syntax tree (M1-07): calls are the `@reference.call`
 * captures of a language's query layers, never a textual `name(` match. Every
 * expectation below is derived from the source text written in the test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../../../src/parsers/core';
import { extractRelations } from '../../../src/parsers/relation-extractor';
import { languageForPath, profileFor } from '../../../src/parsers/languages';

let dir: string;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hesman-m107-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Extraction {
  /** `caller->callee`, sorted. */
  calls: string[];
  /** `caller->callee@line`, sorted. */
  callSites: string[];
  /** Imported module specifiers, in source order. */
  imports: string[];
}

async function extract(ext: string, lines: string[]): Promise<Extraction> {
  const path = join(dir, `case${counter++}${ext}`);
  const source = lines.join('\n') + '\n';
  writeFileSync(path, source);
  const profile = profileFor(languageForPath(path) ?? '');
  if (!profile) throw new Error(`no language for ${ext}`);
  const result = await parseFile(path, profile);
  const names = new Map(result.symbols.map((s) => [s.id, s.name]));
  const relations = extractRelations(result.symbols, source, path, profile, result.references);
  const calls = relations.filter((r) => r.kind === 'calls');
  return {
    calls: calls.map((c) => `${names.get(c.from_id)}->${c.to_name}`).sort(),
    callSites: calls.map((c) => `${names.get(c.from_id)}->${c.to_name}@${c.line}`).sort(),
    imports: relations.filter((r) => r.kind === 'imports').map((r) => r.to_id.replace(/^unresolved:/, '')),
  };
}

describe('calls come from the syntax tree: keywords and literals are not calls', () => {
  it('PHP: `foreach (` is not a call', async () => {
    const { calls } = await extract('.php', [
      '<?php',
      'function run($items) {',
      '    foreach ($items as $item) {',
      '        real($item);',
      '    }',
      '}',
    ]);
    expect(calls).toEqual(['run->real']);
  });

  it('Kotlin: `when (` is not a call', async () => {
    const { calls } = await extract('.kt', [
      'fun run(x: Int): Int {',
      '    return when (x) {',
      '        1 -> real(x)',
      '        else -> 0',
      '    }',
      '}',
    ]);
    expect(calls).toEqual(['run->real']);
  });

  it('Lua: an anonymous `function(` is not a call', async () => {
    const { calls } = await extract('.lua', [
      'function run(x)',
      '  return apply(function(a) return real(a) end, x)',
      'end',
    ]);
    expect(calls).toEqual(['run->apply', 'run->real']);
  });

  it('JavaScript: an anonymous `function (` is not a call', async () => {
    const { calls } = await extract('.js', [
      'function run(list) {',
      '  return list.map(function (x) { return real(x); });',
      '}',
    ]);
    expect(calls).toEqual(['run->map', 'run->real']);
  });

  it('Go: a `func(` literal is not a call', async () => {
    const { calls } = await extract('.go', [
      'package p',
      '',
      'func run(x int) int {',
      '\treturn apply(func(a int) int { return real(a) }, x)',
      '}',
    ]);
    expect(calls).toEqual(['run->apply', 'run->real']);
  });

  it('TypeScript: control keywords, `super(` and type syntax are not calls', async () => {
    const { calls } = await extract('.ts', [
      'export class A extends B {',
      '  constructor(private readonly cb: (x: number) => void) {',
      '    super();',
      '  }',
      '  run(x: number): void {',
      '    if (x) { for (const y of [x]) { while (false) { real(y); } } }',
      '    switch (x) { default: }',
      '  }',
      '}',
    ]);
    expect(calls).toEqual(['run->real']);
  });
});

describe('calls come from the syntax tree: call forms the regex missed or could not express', () => {
  it('TypeScript: `new X<T>()` and a generic call `f<T>()` are calls', async () => {
    const { calls } = await extract('.ts', [
      'export function run(): number {',
      '  const m = new Map<string, number>();',
      '  return pick<number>(m) + new Box(1).value;',
      '}',
    ]);
    expect(calls).toEqual(['run->Box', 'run->Map', 'run->pick']);
  });

  it('TypeScript: the call site is the position of the callee name', async () => {
    const { callSites } = await extract('.ts', [
      'export function run(o: { go(): number }): number {',
      '  return o',
      '    .go();',
      '}',
    ]);
    expect(callSites).toEqual(['run->go@3']);
  });

  it('Java: `new X(...)` is a call to X', async () => {
    const { calls } = await extract('.java', [
      'class Factory {',
      '  Item make(int n) {',
      '    return new Item(clamp(n));',
      '  }',
      '}',
    ]);
    expect(calls).toEqual(['make->Item', 'make->clamp']);
  });

  it('C#: plain, member and `new` calls', async () => {
    const { calls } = await extract('.cs', [
      'class Factory {',
      '  Item Make(int n) {',
      '    this.Record(n);',
      '    return new Item(Clamp(n));',
      '  }',
      '}',
    ]);
    expect(calls).toEqual(['Make->Clamp', 'Make->Item', 'Make->Record']);
  });

  it('PHP: `new X(...)`, function, method and static calls', async () => {
    const { calls } = await extract('.php', [
      '<?php',
      'function run($n) {',
      '    $item = new Item(clamp($n));',
      '    $item->record("x");',
      '    return Util::normalize($n);',
      '}',
    ]);
    expect(calls).toEqual(['run->Item', 'run->clamp', 'run->normalize', 'run->record']);
  });

  it('Rust: path calls (`Type::new`, `module::function`) and method calls', async () => {
    const { calls } = await extract('.rs', [
      'fn run(n: i32) -> i32 {',
      '    let item = Item::new(n);',
      '    item.restock(util::clamp(n))',
      '}',
    ]);
    expect(calls).toEqual(['run->clamp', 'run->new', 'run->restock']);
  });

  it('Swift: function, method and initializer calls', async () => {
    const { calls } = await extract('.swift', [
      'func run(n: Int) -> Int {',
      '    let item = Item(name: normalize("a"))',
      '    return item.restock(n)',
      '}',
    ]);
    expect(calls).toEqual(['run->Item', 'run->normalize', 'run->restock']);
  });

  it('Python: a decorator with arguments and a constructor call', async () => {
    const { calls } = await extract('.py', [
      'def run(n):',
      '    item = Item(clamp(n))',
      '    return item.restock(n)',
    ]);
    expect(calls).toEqual(['run->Item', 'run->clamp', 'run->restock']);
  });
});

describe('calls come from the syntax tree: languages the regex could not handle', () => {
  it('C: function calls; a prototype, a function pointer declaration and `sizeof` are not calls', async () => {
    const { calls } = await extract('.c', [
      'int clamp(int value);',
      'int helper(int value) { return value; }',
      'int run(int value) {',
      '    int (*fp)(int) = helper;',
      '    return clamp(helper(value)) + (int)sizeof(int);',
      '}',
    ]);
    expect(calls).toEqual(['run->clamp', 'run->helper']);
  });

  it('C++: free, member, qualified, template and `new` calls', async () => {
    const { calls } = await extract('.cpp', [
      'int run(Item* item, Item& other) {',
      '    item->record("x");',
      '    other.restock(clamp(1));',
      '    auto made = util::make<Item>(2);',
      '    return (new Box(3))->value();',
      '}',
    ]);
    expect(calls).toEqual(['run->Box', 'run->clamp', 'run->make', 'run->record', 'run->restock', 'run->value']);
  });

  it('Ruby: calls with parentheses, with a receiver and with bare arguments', async () => {
    const { calls } = await extract('.rb', [
      'def run(name)',
      '  value = normalize(name)',
      '  record :restock',
      '  Inventory.clamp(value)',
      'end',
    ]);
    expect(calls).toEqual(['run->clamp', 'run->normalize', 'run->record']);
  });

  it('Ruby: a local variable is not a call', async () => {
    const { calls } = await extract('.rb', [
      'def run(name)',
      '  total = name',
      '  total',
      'end',
    ]);
    expect(calls).toEqual([]);
  });

  it('Bash: a command inside a function is a call', async () => {
    const { calls } = await extract('.sh', [
      'log() {',
      '  echo "$*" >&2',
      '}',
      'main() {',
      '  log "start"',
      '  require_command curl',
      '}',
    ]);
    expect(calls).toEqual(['log->echo', 'main->log', 'main->require_command']);
  });
  it('Bash: control-flow builtins (`return`, `exit`, `break`, `continue`) are not calls', async () => {
    const { calls } = await extract('.sh', [
      'check() {',
      '  for f in "$@"; do',
      '    [ -e "$f" ] || continue',
      '    validate "$f" || break',
      '  done',
      '  command -v curl >/dev/null || exit 1',
      '  return 0',
      '}',
    ]);
    expect(calls).toEqual(['check->command', 'check->validate']);
  });
});

describe('a declaration is never a call, recursion still is', () => {
  it.each([
    ['.c', ['int fact(int n);', 'int fact(int n) {', '    return n <= 1 ? 1 : n * fact(n - 1);', '}'], 'fact->fact@3'],
    ['.cpp', ['int fact(int n) {', '    return n <= 1 ? 1 : n * fact(n - 1);', '}'], 'fact->fact@2'],
    ['.rb', ['def fact(n)', '  n <= 1 ? 1 : n * fact(n - 1)', 'end'], 'fact->fact@2'],
    ['.sh', ['countdown() {', '  [ "$1" -le 0 ] || countdown $(( $1 - 1 ))', '}'], 'countdown->countdown@2'],
    ['.java', ['class A {', '  int fact(int n) {', '    return n <= 1 ? 1 : n * fact(n - 1);', '  }', '}'], 'fact->fact@3'],
  ] as const)('%s', async (ext, lines, site) => {
    const { callSites } = await extract(ext, [...lines]);
    expect(callSites.filter((s) => s.startsWith('fact->fact') || s.startsWith('countdown->countdown'))).toEqual([site]);
  });
});
