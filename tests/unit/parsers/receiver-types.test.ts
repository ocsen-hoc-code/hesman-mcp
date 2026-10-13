/**
 * The type a call's receiver is declared with (M1-10), as extraction records
 * it: a typed declaration, a parameter type, a constructor call, or a typed
 * field of the enclosing class. Every expectation is derived from the source
 * written in the test. Each callee name is unique within its test, so the
 * expectation can be keyed by it.
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
  dir = mkdtempSync(join(tmpdir(), 'hesman-m110-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Receiver type recorded for each callee (`undefined` for a call without a receiver). */
async function receiverTypes(ext: string, lines: string[]): Promise<Record<string, string | null | undefined>> {
  const path = join(dir, `case${counter++}${ext}`);
  const source = lines.join('\n') + '\n';
  writeFileSync(path, source);
  const profile = profileFor(languageForPath(path) ?? '');
  if (!profile) throw new Error(`no language for ${ext}`);
  const result = await parseFile(path, profile);
  const relations = extractRelations(result.symbols, source, path, profile, result.references);
  return Object.fromEntries(
    relations.filter((r) => r.kind === 'calls').map((r) => [r.to_name, r.receiverType ?? (r.receiver === undefined || r.receiver === null ? undefined : null)]),
  );
}

describe('the type of a receiver (M1-10)', () => {
  it('TypeScript: a union with undefined or null names its one type; another union names none', async () => {
    const types = await receiverTypes('.ts', [
      'function run(a: Store | undefined, b: Store | Cache) {',
      '  a.load();',
      '  b.save();',
      '}',
    ]);
    expect(types.load).toBe('Store');
    expect(types.save).toBeNull();
  });

  it('TypeScript: typed parameters and locals, constructor calls, a built-in type, a typed field', async () => {
    const types = await receiverTypes('.ts', [
      'class Store { load(): void {} }',
      'class Cache { save(): void {} }',
      'class Owner {',
      '  private store: Store = new Store();',
      '  run(s: Store, m: Map<string, number>, u) {',
      '    const c = new Cache();',
      '    s.load();',
      '    m.read();',
      '    c.save();',
      '    u.drop();',
      '    this.store.fetch();',
      '  }',
      '}',
    ]);
    expect(types.load).toBe('Store');
    expect(types.read).toBe('Map');
    expect(types.save).toBe('Cache');
    expect(types.drop).toBeNull();
    expect(types.fetch).toBe('Store');
  });

  it('Python: annotated parameters and assignments, constructor calls, a field set in a method', async () => {
    const types = await receiverTypes('.py', [
      'class Store:',
      '    def load(self):',
      '        pass',
      '',
      'class Owner:',
      '    def __init__(self, s: Store):',
      '        self.store = Store()',
      '        self.param = s',
      '',
      '    def run(self, d: dict, u):',
      '        c = Store()',
      '        d.read()',
      '        c.load()',
      '        u.drop()',
      '        self.store.fetch()',
    ]);
    expect(types.read).toBe('dict');
    expect(types.load).toBe('Store');
    expect(types.drop).toBeNull();
    expect(types.fetch).toBe('Store');
  });

  it('Go: pointer parameters, var declarations, composite literals and a qualified type', async () => {
    const types = await receiverTypes('.go', [
      'package main',
      'type Store struct{}',
      'func (s *Store) Load() {}',
      'func run(p *Store, u interface{}) {',
      '    var sb strings.Builder',
      '    c := &Cache{}',
      '    p.Load()',
      '    sb.Write()',
      '    c.Save()',
      '    u.Drop()',
      '}',
    ]);
    expect(types.Load).toBe('Store');
    expect(types.Write).toBe('Builder');
    expect(types.Save).toBe('Cache');
    expect(types.Drop).toBeNull();
  });

  it('Java: parameter and local types, object creation, `var`, a generic type', async () => {
    const types = await receiverTypes('.java', [
      'class Run {',
      '  void run(Store p, Object u) {',
      '    Cache c = new Cache();',
      '    var v = new Lazy();',
      '    java.util.List<String> xs = null;',
      '    p.load();',
      '    c.save();',
      '    v.make();',
      '    xs.read();',
      '    u.drop();',
      '  }',
      '}',
    ]);
    expect(types.load).toBe('Store');
    expect(types.save).toBe('Cache');
    expect(types.make).toBe('Lazy');
    expect(types.read).toBe('List');
    expect(types.drop).toBe('Object');
  });

  it('Rust: reference parameters, `Type::new()`, struct literals and a generic built-in type', async () => {
    const types = await receiverTypes('.rs', [
      'struct Store { a: i32 }',
      'impl Store { fn load(&self) {} }',
      'fn run(p: &Store, u: i32) {',
      '    let c = Cache::new();',
      '    let v: Vec<i32> = Vec::new();',
      '    let t = Store { a: 1 };',
      '    p.load();',
      '    c.save();',
      '    v.read();',
      '    t.lift();',
      '    u.drop();',
      '}',
    ]);
    expect(types.load).toBe('Store');
    expect(types.save).toBe('Cache');
    expect(types.read).toBe('Vec');
    expect(types.lift).toBe('Store');
    expect(types.drop).toBe('i32');
  });
});
