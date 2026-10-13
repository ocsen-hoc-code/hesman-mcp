/**
 * Member-call links by receiver type (M1-10), through the real indexing
 * pipeline, in five languages. Each project is the smallest one that shows the
 * four cases of the rule for a call `x.m()`:
 * - typed: `x` is declared with a project class → the method of that class;
 * - constructed: `x` is assigned the result of `new C()` / `C()` → the method of C;
 * - built-in: `x` is declared with a type that is not in the project (`Map`,
 *   `dict`, `Vec`, `strings.Builder`) → unlinked, even when a project class
 *   has a method of the same name that the file imports;
 * - unknown: `x` has no type the rule can read → only the own file, an
 *   imported file or the directory tier; a method of an unrelated directory is
 *   not linked by name.
 * Every expectation is derived from the sources written below.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { indexProject } from '../../src/indexing/index-coordinator';
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

async function indexed(files: Record<string, string[]>): Promise<{ root: string; db: SqliteStore }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-m110-links-')));
  for (const [path, lines] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), lines.join('\n') + '\n');
  }
  project = root;
  store = new SqliteStore(join(root, '.hesman'));
  store.open();
  const result = await indexProject(root, store, config);
  expect(result.errors).toEqual([]);
  return { root, db: store };
}

/** `name @ file` of every callable (not a class) the function `caller` of `file` calls, sorted. */
function callablesCalledBy(root: string, db: SqliteStore, file: string, caller: string): string[] {
  const path = join(root, file);
  const fromId = caller === '<module>' ? moduleCallerId(path) : db.getSymbolsByFile(path).find((s) => s.name === caller)?.id;
  if (!fromId) throw new Error(`symbol ${caller} not indexed in ${file}`);
  return db
    .getCallees(fromId)
    .filter((c) => c.kind !== 'class')
    .map((c) => `${c.name} @ ${relative(root, c.filePath)}`)
    .sort();
}

describe('member calls linked by the declared type of the receiver (M1-10)', () => {
  it('TypeScript: typed, constructed, built-in and unknown receivers', async () => {
    const { root, db } = await indexed({
      'src/store.ts': [
        'export class Store {',
        '  load(): number { return 1; }',
        '}',
        'export class Cache {',
        '  fill(): number { return 2; }',
        '}',
        'export class Registry {',
        '  get(k: string): string { return k; }',
        '}',
      ],
      'src/lib/lru.ts': ['export class Lru {', '  size(): number { return 0; }', '}'],
      'src/use.ts': [
        "import { Store, Cache, Registry } from './store.js';",
        'export function typed(s: Store): number {',
        '  return s.load();',
        '}',
        'export function constructed(): number {',
        '  const c = new Cache();',
        '  return c.fill();',
        '}',
        'export function builtin(m: Map<string, string>): string | undefined {',
        "  return m.get('k');",
        '}',
        'export function unknown(x): number {',
        '  return x.size();',
        '}',
      ],
    });
    expect(callablesCalledBy(root, db, 'src/use.ts', 'typed')).toEqual(['load @ src/store.ts']);
    expect(callablesCalledBy(root, db, 'src/use.ts', 'constructed')).toEqual(['fill @ src/store.ts']);
    expect(callablesCalledBy(root, db, 'src/use.ts', 'builtin')).toEqual([]);
    expect(callablesCalledBy(root, db, 'src/use.ts', 'unknown')).toEqual([]);
  });

  it('Python: annotated, constructed, built-in and unknown receivers', async () => {
    const { root, db } = await indexed({
      'src/store.py': [
        'class Store:',
        '    def load(self):',
        '        return 1',
        '',
        'class Cache:',
        '    def fill(self):',
        '        return 2',
        '',
        'class Registry:',
        '    def get(self, k):',
        '        return k',
      ],
      'src/lib/lru.py': ['class Lru:', '    def size(self):', '        return 0'],
      'src/use.py': [
        'from store import Store, Cache',
        '',
        'def typed(s: Store):',
        '    return s.load()',
        '',
        'def constructed():',
        '    c = Cache()',
        '    return c.fill()',
        '',
        'def builtin(d: dict):',
        "    return d.get('k')",
        '',
        'def unknown(x):',
        '    return x.size()',
      ],
    });
    expect(callablesCalledBy(root, db, 'src/use.py', 'typed')).toEqual(['load @ src/store.py']);
    expect(callablesCalledBy(root, db, 'src/use.py', 'constructed')).toEqual(['fill @ src/store.py']);
    expect(callablesCalledBy(root, db, 'src/use.py', 'builtin')).toEqual([]);
    expect(callablesCalledBy(root, db, 'src/use.py', 'unknown')).toEqual([]);
  });

  it('Go: pointer, constructed, qualified built-in and unknown receivers', async () => {
    const { root, db } = await indexed({
      'go.mod': ['module example.com/m', '', 'go 1.21'],
      'store/store.go': [
        'package store',
        '',
        'type Store struct{}',
        'func (s *Store) Load() int { return 1 }',
        '',
        'type Cache struct{}',
        'func (c *Cache) Fill() int { return 2 }',
        '',
        'type Registry struct{}',
        'func (r *Registry) Get(k string) string { return k }',
      ],
      'lib/lru.go': ['package lib', '', 'type Lru struct{}', 'func (l *Lru) Size() int { return 0 }'],
      'use/use.go': [
        'package use',
        '',
        'import (',
        '\t"strings"',
        '',
        '\t"example.com/m/store"',
        ')',
        '',
        'func Typed(s *store.Store) int {',
        '\treturn s.Load()',
        '}',
        '',
        'func Constructed() int {',
        '\tc := &store.Cache{}',
        '\treturn c.Fill()',
        '}',
        '',
        'func Builtin(b strings.Builder) string {',
        '\treturn b.Get()',
        '}',
        '',
        'func Unknown(x interface{}) int {',
        '\treturn x.Size()',
        '}',
      ],
    });
    expect(callablesCalledBy(root, db, 'use/use.go', 'Typed')).toEqual(['Load @ store/store.go']);
    expect(callablesCalledBy(root, db, 'use/use.go', 'Constructed')).toEqual(['Fill @ store/store.go']);
    expect(callablesCalledBy(root, db, 'use/use.go', 'Builtin')).toEqual([]);
    expect(callablesCalledBy(root, db, 'use/use.go', 'Unknown')).toEqual([]);
  });

  it('Java: typed, constructed, built-in and unknown receivers', async () => {
    const { root, db } = await indexed({
      'src/Store.java': ['class Store {', '  int load() { return 1; }', '}', 'class Cache {', '  int fill() { return 2; }', '}', 'class Registry {', '  String get(String k) { return k; }', '}'],
      'src/lib/Lru.java': ['class Lru {', '  int size() { return 0; }', '}'],
      'src/Use.java': [
        'import java.util.Map;',
        '',
        'class Use {',
        '  int typed(Store s) { return s.load(); }',
        '  int constructed() { Cache c = new Cache(); return c.fill(); }',
        '  String builtin(Map<String, String> m) { return m.get("k"); }',
        '  int unknown() { var x = makeLru(); return x.size(); }',
        '  Lru makeLru() { return new Lru(); }',
        '}',
      ],
    });
    expect(callablesCalledBy(root, db, 'src/Use.java', 'typed')).toEqual(['load @ src/Store.java']);
    expect(callablesCalledBy(root, db, 'src/Use.java', 'constructed')).toEqual(['fill @ src/Store.java']);
    expect(callablesCalledBy(root, db, 'src/Use.java', 'builtin')).toEqual([]);
    expect(callablesCalledBy(root, db, 'src/Use.java', 'unknown')).toEqual(['makeLru @ src/Use.java']);
  });

  it('Rust: reference, `Type::new()`, built-in and unknown receivers', async () => {
    const { root, db } = await indexed({
      'src/store.rs': [
        'pub struct Store;',
        'impl Store {',
        '    pub fn load(&self) -> i32 { 1 }',
        '}',
        'pub struct Cache;',
        'impl Cache {',
        '    pub fn new() -> Cache { Cache }',
        '    pub fn fill(&self) -> i32 { 2 }',
        '}',
        'pub struct Registry;',
        'impl Registry {',
        '    pub fn get(&self) -> i32 { 3 }',
        '}',
      ],
      'src/lib/lru.rs': ['pub struct Lru;', 'impl Lru {', '    pub fn size(&self) -> i32 { 0 }', '}'],
      'src/use.rs': [
        'use crate::store::{Cache, Store};',
        '',
        'pub fn make_lru() -> i32 { 0 }',
        '',
        'pub fn typed(s: &Store) -> i32 {',
        '    s.load()',
        '}',
        'pub fn constructed() -> i32 {',
        '    let c = Cache::new();',
        '    c.fill()',
        '}',
        'pub fn builtin() -> i32 {',
        '    let v: Vec<i32> = Vec::new();',
        '    v.get(0)',
        '}',
        'pub fn unknown() -> i32 {',
        '    let x = make_lru();',
        '    x.size()',
        '}',
      ],
    });
    expect(callablesCalledBy(root, db, 'src/use.rs', 'typed')).toEqual(['load @ src/store.rs']);
    expect(callablesCalledBy(root, db, 'src/use.rs', 'constructed')).toEqual(['fill @ src/store.rs', 'new @ src/store.rs']);
    expect(callablesCalledBy(root, db, 'src/use.rs', 'builtin')).toEqual([]);
    expect(callablesCalledBy(root, db, 'src/use.rs', 'unknown')).toEqual([]);
  });
});
