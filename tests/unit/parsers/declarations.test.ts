/**
 * `is_declaration` (M1-07): a function or method declared without a body — a
 * C/C++ prototype, an interface, abstract or trait method — is flagged so that
 * the call resolver prefers a same-named definition. Expectations are derived
 * from the source text written in each case.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../../../src/parsers/core';
import { languageForPath, profileFor } from '../../../src/parsers/languages';

let dir: string;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hesman-m107-decl-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** `name@line` of every function/method flagged as a declaration, and of every one that is not. */
async function flags(ext: string, lines: string[]): Promise<{ declarations: string[]; definitions: string[] }> {
  const path = join(dir, `case${counter++}${ext}`);
  writeFileSync(path, lines.join('\n') + '\n');
  const profile = profileFor(languageForPath(path) ?? '');
  if (!profile) throw new Error(`no language for ${ext}`);
  const { symbols } = await parseFile(path, profile);
  const callables = symbols.filter((s) => s.kind === 'function' || s.kind === 'method');
  const label = (s: { name: string; start_line: number }): string => `${s.name}@${s.start_line}`;
  return {
    declarations: callables.filter((s) => s.is_declaration === 1).map(label).sort(),
    definitions: callables.filter((s) => s.is_declaration !== 1).map(label).sort(),
  };
}

describe('is_declaration: body-less callables', () => {
  it('C: a prototype is a declaration, its definition is not', async () => {
    expect(await flags('.c', ['int clamp(int value);', 'int clamp(int value)', '{', '    return value;', '}'])).toEqual({
      declarations: ['clamp@1'],
      definitions: ['clamp@2'],
    });
  });

  it('C++: a member declared in the class and a pure virtual are declarations; inline and out-of-class definitions are not', async () => {
    expect(
      await flags('.cpp', [
        'struct Stocker {',
        '    virtual int restock(int amount) = 0;',
        '};',
        'class Item : public Stocker {',
        'public:',
        '    int restock(int amount) override;',
        '    int count() const { return count_; }',
        'private:',
        '    int count_ = 0;',
        '};',
        'int Item::restock(int amount) {',
        '    return amount;',
        '}',
      ]),
    ).toEqual({ declarations: ['restock@2', 'restock@6'], definitions: ['count@7', 'restock@11'] });
  });

  it('Java: interface and abstract methods are declarations', async () => {
    expect(
      await flags('.java', [
        'interface Stocker {',
        '    int restock(int amount);',
        '}',
        'abstract class Base implements Stocker {',
        '    abstract int count();',
        '    public int restock(int amount) { return amount; }',
        '}',
      ]),
    ).toEqual({ declarations: ['count@5', 'restock@2'], definitions: ['restock@6'] });
  });

  it('C#: an interface method is a declaration; block and expression bodies are definitions', async () => {
    expect(
      await flags('.cs', [
        'interface IStocker {',
        '    int Restock(int amount);',
        '}',
        'class Item : IStocker {',
        '    public int Restock(int amount) { return amount; }',
        '    public int Count() => 1;',
        '}',
      ]),
    ).toEqual({ declarations: ['Restock@2'], definitions: ['Count@6', 'Restock@5'] });
  });

  it('Kotlin: an interface method is a declaration; block and expression bodies are definitions', async () => {
    expect(
      await flags('.kt', [
        'interface Stocker {',
        '    fun restock(amount: Int): Int',
        '}',
        'class Item : Stocker {',
        '    override fun restock(amount: Int): Int { return amount }',
        '    fun count(): Int = 1',
        '}',
      ]),
    ).toEqual({ declarations: ['restock@2'], definitions: ['count@6', 'restock@5'] });
  });

  it('Swift: a protocol requirement is a declaration', async () => {
    expect(
      await flags('.swift', [
        'protocol Stocker {',
        '    func restock(amount: Int) -> Int',
        '}',
        'struct Item: Stocker {',
        '    func restock(amount: Int) -> Int { return amount }',
        '}',
      ]),
    ).toEqual({ declarations: ['restock@2'], definitions: ['restock@5'] });
  });

  it('PHP: interface and abstract methods are declarations', async () => {
    expect(
      await flags('.php', [
        '<?php',
        'interface Stocker {',
        '    public function restock(int $amount): int;',
        '}',
        'class Item implements Stocker {',
        '    public function restock(int $amount): int { return $amount; }',
        '}',
      ]),
    ).toEqual({ declarations: ['restock@3'], definitions: ['restock@6'] });
  });

  it('Rust: a trait method without a body is not indexed at all; a default method and an impl are definitions', async () => {
    expect(
      await flags('.rs', [
        'pub trait Stocker {',
        '    fn restock(&mut self, amount: i32) -> i32;',
        '    fn twice(&mut self) -> i32 { 2 }',
        '}',
        'impl Stocker for Item {',
        '    fn restock(&mut self, amount: i32) -> i32 { amount }',
        '}',
      ]),
    ).toEqual({ declarations: [], definitions: ['restock@6', 'twice@3'] });
  });

  it('Go: an interface method is not indexed as a callable; the method that implements it is a definition', async () => {
    expect(
      await flags('.go', [
        'package p',
        '',
        'type Stocker interface {',
        '\tRestock(amount int) int',
        '}',
        '',
        'func (i *Item) Restock(amount int) int { return amount }',
      ]),
    ).toEqual({ declarations: [], definitions: ['Restock@7'] });
  });

  it.each([
    ['.ts', ['export function a(): void {}', 'export const b = (): number => 1;', 'export class C { d(): void {} }'], ['a@1', 'b@1', 'd@3'].length],
    ['.js', ['function a() {}', 'const b = () => 1;', 'const o = { c: function () {} };'], 3],
    ['.py', ['def a():', '    pass', '', 'class C:', '    def b(self):', '        """Doc."""'], 2],
    ['.rb', ['def a; end', 'def b', 'end', 'def c = 1'], 3],
    ['.lua', ['function a() end', 'local function b()', 'end', 'local t = {}', 'function t.c() return 1 end'], 3],
    ['.sh', ['a() { :; }', 'function b {', '  :', '}'], 2],
  ] as const)('%s: every function has a body, however small', async (ext, lines, count) => {
    const { declarations, definitions } = await flags(ext, [...lines]);
    expect(declarations).toEqual([]);
    expect(definitions).toHaveLength(count);
  });
});
