/**
 * Extraction bugs found by the conformance suite (M1-08). Every expectation
 * below is derived from the source text written in the test, never from
 * extractor output.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile, type ExtractedSymbol } from '../../../src/parsers/core';
import { extractRelations } from '../../../src/parsers/relation-extractor';
import { MAX_SIGNATURE_LENGTH } from '../../../src/parsers/tags-engine';
import type { LanguageProfile } from '../../../src/parsers/language-profile';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { pythonProfile } from '../../../src/parsers/profiles/python';
import { goProfile } from '../../../src/parsers/profiles/go';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANGUAGE_FIXTURES = resolve(__dirname, '..', '..', 'fixtures', 'languages');

let dir: string;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hesman-m108-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Extraction {
  symbols: ExtractedSymbol[];
  /** `caller->callee` of every `calls` relation. */
  calls: string[];
  /** `caller->callee@line` of every `calls` relation. */
  callSites: string[];
}

async function extractFile(path: string, profile: LanguageProfile, source: string): Promise<Extraction> {
  const result = await parseFile(path, profile);
  const names = new Map(result.symbols.map((s) => [s.id, s.name]));
  const calls = extractRelations(result.symbols, source, path, profile, result.ignoredRanges).filter((r) => r.kind === 'calls');
  return {
    symbols: result.symbols,
    calls: calls.map((c) => `${names.get(c.from_id)}->${c.to_name}`),
    callSites: calls.map((c) => `${names.get(c.from_id)}->${c.to_name}@${c.line}`),
  };
}

async function extract(ext: string, profile: LanguageProfile, lines: string[]): Promise<Extraction> {
  const path = join(dir, `case${counter++}${ext}`);
  const source = lines.join('\n') + '\n';
  writeFileSync(path, source);
  return extractFile(path, profile, source);
}

/** `kind:name` → is_exported, for every symbol. */
function exported(symbols: ExtractedSymbol[]): Record<string, number> {
  return Object.fromEntries(symbols.map((s) => [`${s.kind}:${s.name}`, s.is_exported]));
}

function signature(symbols: ExtractedSymbol[], name: string): string | null {
  const found = symbols.find((s) => s.name === name);
  if (!found) throw new Error(`symbol ${name} not extracted`);
  return found.signature;
}

// ---------------------------------------------------------------------------
// 1. isExported of nested declarations and private members
// ---------------------------------------------------------------------------

describe('M1-08 item 1: isExported in TypeScript/JavaScript', () => {
  it('does not export declarations local to an exported function', async () => {
    const { symbols } = await extract('.ts', tsProfile, [
      'export function outer(): number {',
      '  function inner(): number { return 1; }',
      '  const localArrow = () => inner();',
      '  const localValue = 2;',
      '  return localArrow() + localValue;',
      '}',
      'export const outerArrow = () => {',
      '  const nested = () => 1;',
      '  return nested();',
      '};',
    ]);
    const exp = exported(symbols);
    expect(exp['function:outer']).toBe(1);
    expect(exp['function:outerArrow']).toBe(1);
    expect(exp['function:inner']).toBe(0);
    expect(exp['function:localArrow']).toBe(0);
    expect(exp['variable:localValue']).toBe(0);
    expect(exp['function:nested']).toBe(0);
  });

  it('exports only the public members of an exported class', async () => {
    const { symbols } = await extract('.ts', tsProfile, [
      'export class Box {',
      '  constructor(private size: number) {}',
      '  open(): void {}',
      '  public explicit(): void {}',
      '  static make(): Box { return new Box(1); }',
      '  private seal(): void {}',
      '  protected hinge(): void {}',
      '  #lock(): void {}',
      '}',
      'class Hidden {',
      '  visible(): void {}',
      '}',
    ]);
    const exp = exported(symbols);
    expect(exp['class:Box']).toBe(1);
    expect(exp['method:constructor']).toBe(1);
    expect(exp['method:open']).toBe(1);
    expect(exp['method:explicit']).toBe(1);
    expect(exp['method:make']).toBe(1);
    expect(exp['method:seal']).toBe(0);
    expect(exp['method:hinge']).toBe(0);
    expect(exp['method:#lock']).toBe(0);
    expect(exp['class:Hidden']).toBe(0);
    expect(exp['method:visible']).toBe(0);
  });

  it('does not export what is merely nested in an exported value', async () => {
    const { symbols } = await extract('.ts', tsProfile, [
      'export const handlers = {',
      '  onClick: () => 1,',
      '};',
      'export const value = compute(function named() { return 1; });',
    ]);
    const exp = exported(symbols);
    expect(exp['variable:handlers']).toBe(1);
    expect(exp['function:onClick']).toBe(0);
    expect(exp['variable:value']).toBe(1);
    expect(exp['function:named']).toBe(0);
  });

  it('follows namespaces: an export inside a namespace is exported iff the namespace is', async () => {
    const { symbols } = await extract('.ts', tsProfile, [
      'export namespace Api {',
      '  export function pub(): void {}',
      '  function priv(): void {}',
      '}',
      'namespace Internal {',
      '  export function unreachable(): void {}',
      '}',
    ]);
    const exp = exported(symbols);
    expect(exp['namespace:Api']).toBe(1);
    expect(exp['function:pub']).toBe(1);
    expect(exp['function:priv']).toBe(0);
    expect(exp['namespace:Internal']).toBe(0);
    expect(exp['function:unreachable']).toBe(0);
  });

  it('exports top-level declarations of every kind, and the names of an export list', async () => {
    const { symbols } = await extract('.ts', tsProfile, [
      'export interface Shape { id: string }',
      'export type Id = string;',
      'export enum Color { Red }',
      'export abstract class Base {}',
      'export default function main(): void {}',
      'export declare const ambient: number;',
      'function listed(): void {}',
      'const renamedLocal = 1;',
      'function fallback(): void {}',
      'function notListed(): void {}',
      'export { listed, renamedLocal as renamed };',
      'export { reexported } from "./other.js";',
      'function reexported(): void {}',
    ]);
    const exp = exported(symbols);
    expect(exp['interface:Shape']).toBe(1);
    expect(exp['type:Id']).toBe(1);
    expect(exp['enum:Color']).toBe(1);
    expect(exp['class:Base']).toBe(1);
    expect(exp['function:main']).toBe(1);
    expect(exp['variable:ambient']).toBe(1);
    expect(exp['function:listed']).toBe(1);
    expect(exp['variable:renamedLocal']).toBe(1);
    expect(exp['function:fallback']).toBe(0);
    expect(exp['function:notListed']).toBe(0);
    // `export { x } from` re-exports another module's binding, not the local one.
    expect(exp['function:reexported']).toBe(0);
  });

  it('exports the identifier named by `export default name`', async () => {
    const { symbols } = await extract('.ts', tsProfile, [
      'function chosen(): void {}',
      'function other(): void {}',
      'export default chosen;',
    ]);
    const exp = exported(symbols);
    expect(exp['function:chosen']).toBe(1);
    expect(exp['function:other']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. CommonJS exports
// ---------------------------------------------------------------------------

describe('M1-08 item 2: CommonJS exports', () => {
  it('exports the names listed in `module.exports = { ... }`', async () => {
    const { symbols } = await extract('.js', tsProfile, [
      'function listed() {}',
      'function aliasedLocal() {}',
      'function notListed() {}',
      'class Service {',
      '  start() {}',
      '}',
      'const LIMIT = 3;',
      'module.exports = { listed, alias: aliasedLocal, Service, LIMIT, inline: function () {} };',
    ]);
    const exp = exported(symbols);
    expect(exp['function:listed']).toBe(1);
    expect(exp['function:aliasedLocal']).toBe(1);
    expect(exp['class:Service']).toBe(1);
    expect(exp['method:start']).toBe(1);
    expect(exp['variable:LIMIT']).toBe(1);
    expect(exp['function:inline']).toBe(1);
    expect(exp['function:notListed']).toBe(0);
  });

  it('exports `module.exports.a = ...` and `exports.a = ...`', async () => {
    const { symbols } = await extract('.js', tsProfile, [
      'function byName() {}',
      'function untouched() {}',
      'module.exports.first = function () {};',
      'exports.second = () => 1;',
      'exports.byName = byName;',
      'const registry = {};',
      'registry.plugin = function () {};',
      'other.exports.fake = function () {};',
    ]);
    const exp = exported(symbols);
    expect(exp['function:first']).toBe(1);
    expect(exp['function:second']).toBe(1);
    expect(exp['function:byName']).toBe(1);
    expect(exp['function:untouched']).toBe(0);
    expect(exp['function:plugin']).toBe(0);
    expect(exp['function:fake']).toBe(0);
    expect(exp['variable:registry']).toBe(0);
  });

  it('exports the single value of `module.exports = name`', async () => {
    const { symbols } = await extract('.js', tsProfile, [
      'function main() {}',
      'function helper() {}',
      'module.exports = main;',
    ]);
    const exp = exported(symbols);
    expect(exp['function:main']).toBe(1);
    expect(exp['function:helper']).toBe(0);
  });

  it('ignores a `module.exports` assignment that is not at the top level, and locals with a listed name', async () => {
    const { symbols } = await extract('.js', tsProfile, [
      'function setup() {',
      '  function shadow() {}',
      '  module.exports = { conditional };',
      '  return shadow;',
      '}',
      'function conditional() {}',
      'function shadow() {}',
      'module.exports = { shadow };',
    ]);
    const exportedShadows = symbols.filter((s) => s.name === 'shadow').map((s) => [s.start_line, s.is_exported]);
    expect(exportedShadows).toEqual([[2, 0], [7, 1]]);
    expect(exported(symbols)['function:conditional']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Python tuple assignment
// ---------------------------------------------------------------------------

describe('M1-08 item 3: Python tuple assignment', () => {
  it('indexes every name of a module-level tuple assignment', async () => {
    const { symbols } = await extract('.py', pythonProfile, [
      'LOW, HIGH = 5, 50',
      '(LEFT, RIGHT) = 1, 2',
      '_HIDDEN, SHOWN = 0, 1',
      'SINGLE = 3',
    ]);
    const rows = symbols.map((s) => [s.name, s.kind, s.start_line, s.is_exported]);
    expect(rows).toEqual([
      ['LOW', 'constant', 1, 1],
      ['HIGH', 'constant', 1, 1],
      ['LEFT', 'constant', 2, 1],
      ['RIGHT', 'constant', 2, 1],
      ['_HIDDEN', 'constant', 3, 0],
      ['SHOWN', 'constant', 3, 1],
      ['SINGLE', 'constant', 4, 1],
    ]);
    expect(signature(symbols, 'HIGH')).toBe('LOW, HIGH = 5, 50');
    expect(new Set(symbols.map((s) => s.id)).size).toBe(symbols.length);
  });

  it('does not index tuple assignments inside a function, or non-name targets', async () => {
    const { symbols } = await extract('.py', pythonProfile, [
      'def swap(pair):',
      '    first, second = pair',
      '    return second, first',
      '',
      'config.a, config.b = 1, 2',
    ]);
    expect(symbols.map((s) => s.name)).toEqual(['swap']);
  });
});

// ---------------------------------------------------------------------------
// 4. False calls
// ---------------------------------------------------------------------------

describe('M1-08 item 4: no calls from strings, comments or signature-only declarations', () => {
  it('Go fixture: no call from a format string or an interface method specification', async () => {
    const path = join(LANGUAGE_FIXTURES, 'go', 'inventory.go');
    const { calls } = await extractFile(path, goProfile, '');
    // `"%s (%d, %s)"` on line 51 is a string; `Restock(amount int) int` on line 32 is a method spec.
    expect(calls).not.toContain('label->s');
    expect(calls).not.toContain('Stocker->Restock');
    // Real calls on the same lines and elsewhere survive.
    expect(calls).toContain('label->Sprintf');
    expect(calls).toContain('Restock->clamp');
    expect(calls).toContain('NewItem->normalize');
  });

  it('TypeScript fixture: no call from an interface method signature', async () => {
    const path = join(LANGUAGE_FIXTURES, 'typescript', 'shapes.ts');
    const { calls } = await extractFile(path, tsProfile, '');
    expect(calls).not.toContain('Shape->area');
    expect(calls).toContain('addArea->area');
    expect(calls).toContain('constructor->clampRadius');
  });

  it('TypeScript: strings, comments and regular expressions hold no calls; template substitutions do', async () => {
    const { calls } = await extract('.ts', tsProfile, [
      'export function run(input: string): string {',
      '  // commented(input) is not a call',
      '  /* neither is blockComment(input) */',
      "  const a = 'single(1)';",
      '  const b = "double(2)";',
      '  const c = /regex(3)/.test(input);',
      '  const d = `template(4) ${real(input)} tail(5)`;',
      '  return after(a + b + c + d); // trailing(6)',
      '}',
    ]);
    expect(calls.sort()).toEqual(['run->after', 'run->real', 'run->test']);
  });

  it('TypeScript: abstract members, overloads and ambient functions are not calls', async () => {
    const { calls } = await extract('.ts', tsProfile, [
      'export abstract class Base {',
      '  abstract area(): number;',
      '  scale(factor: number): number;',
      '  scale(factor: string): number;',
      '  scale(factor: number | string): number {',
      '    return this.area() * Number(factor);',
      '  }',
      '}',
      'export interface Callable {',
      '  (x: number): string;',
      '  method(x: number): string;',
      '  nested: { inner(y: number): void };',
      '}',
      'export declare namespace Ambient {',
      '  function declared(x: number): void;',
      '}',
    ]);
    expect(calls.sort()).toEqual(['scale->Number', 'scale->area']);
  });

  it('Python: docstrings, comments and strings hold no calls; f-string interpolations do', async () => {
    const { calls } = await extract('.py', pythonProfile, [
      'def run(value):',
      '    """Use helper(value) to run."""',
      '    # commented(value)',
      "    plain = 'quoted(value)'",
      '    return f"{real(value)} literal(value)" + after(plain)',
    ]);
    expect(calls.sort()).toEqual(['run->after', 'run->real']);
  });

  it('Go: comments, raw strings and interface method specs are not calls', async () => {
    const { calls } = await extract('.go', goProfile, [
      'package demo',
      '',
      'type Runner interface {',
      '\tRun(n int) int',
      '\tStop()',
      '}',
      '',
      'func Start(r Runner) int {',
      '\t// commented(r)',
      '\traw := `raw(1)`',
      '\treturn r.Run(len(raw)) /* block(2) */',
      '}',
    ]);
    expect(calls.sort()).toEqual(['Start->Run', 'Start->len']);
  });

  it('keeps offsets right after non-ASCII text', async () => {
    const { callSites } = await extract('.ts', tsProfile, [
      'export function run(): string {',
      "  const a = 'héllo wörld 😀 fake(1)';",
      '  return real(a); // ünïcode(2)',
      '}',
    ]);
    expect(callSites).toEqual(['run->real@3']);
  });

  it('still records recursion and still never treats a declaration as a call (M0-13)', async () => {
    const { callSites } = await extract('.ts', tsProfile, [
      'export function fact(n: number): number {',
      '  return n <= 1 ? 1 : n * fact(n - 1);',
      '}',
      'export function f(n: number): number { return n ? f(n - 1) : 0; }',
    ]);
    expect(callSites.sort()).toEqual(['f->f@4', 'fact->fact@2']);
  });

  it('behaves as before when no ignored ranges are passed', async () => {
    const path = join(dir, 'legacy-call.ts');
    const source = "export function run(): string {\n  return real('x');\n}\n";
    writeFileSync(path, source);
    const result = await parseFile(path, tsProfile);
    const calls = extractRelations(result.symbols, source, path, tsProfile).filter((r) => r.kind === 'calls');
    expect(calls.map((c) => c.to_name)).toEqual(['real']);
  });
});

// ---------------------------------------------------------------------------
// 5. Multi-line signatures
// ---------------------------------------------------------------------------

describe('M1-08 item 5: multi-line signatures', () => {
  it('TypeScript fixture: the multi-line constructor has its full parameter list', async () => {
    const path = join(LANGUAGE_FIXTURES, 'typescript', 'shapes.ts');
    const { symbols } = await extractFile(path, tsProfile, '');
    expect(signature(symbols, 'constructor')).toBe('constructor(public readonly id: ShapeId, radius: number)');
    // One-line signatures are unchanged.
    expect(signature(symbols, 'clampRadius')).toBe('function clampRadius(radius: number): number');
    expect(signature(symbols, 'area')).toBe('area(): number');
  });

  it('TypeScript: functions, methods and arrow functions with parameters on several lines', async () => {
    const { symbols } = await extract('.ts', tsProfile, [
      'export async function load(',
      '  path: string,',
      '  options: { retries: number } = { retries: 1 },',
      '): Promise<string> {',
      '  return path + options.retries;',
      '}',
      'export class Store {',
      '  save(',
      '    key: string,',
      '    value: number',
      '  ): void {}',
      '}',
      'export const combine = (',
      '  left: number,',
      '  right: number,',
      '): number => left + right;',
      'export const single = (only: number): number => only;',
    ]);
    expect(signature(symbols, 'load')).toBe(
      'async function load(path: string, options: { retries: number } = { retries: 1 }): Promise<string>',
    );
    expect(signature(symbols, 'save')).toBe('save(key: string, value: number): void');
    expect(signature(symbols, 'combine')).toBe('combine = (left: number, right: number): number =>');
    // A one-line definition is unchanged (the `;` belongs to the statement, not to the declarator).
    expect(signature(symbols, 'single')).toBe('single = (only: number): number => only');
  });

  it('Python and Go: parameters on several lines', async () => {
    const py = await extract('.py', pythonProfile, [
      'def connect(',
      '    host,',
      '    port=5432,',
      ') -> bool:',
      '    return True',
    ]);
    expect(signature(py.symbols, 'connect')).toBe('def connect(host, port=5432) -> bool');

    const go = await extract('.go', goProfile, [
      'package demo',
      '',
      'func Connect(',
      '\thost string,',
      '\tport int,',
      ') (bool, error) {',
      '\treturn true, nil',
      '}',
    ]);
    expect(signature(go.symbols, 'Connect')).toBe('func Connect(host string, port int) (bool, error)');
  });

  it('leaves comments between parameters out of the signature', async () => {
    const { symbols } = await extract('.ts', tsProfile, [
      'export function check(',
      '  client: string,',
      '  /** Directory the server starts in (see `cwd`). */',
      '  dir: string, // trailing note',
      '  // a line comment',
      '  retries = 3,',
      '): boolean {',
      '  return client.length + dir.length > retries;',
      '}',
    ]);
    expect(signature(symbols, 'check')).toBe('function check(client: string, dir: string, retries = 3): boolean');

    const py = await extract('.py', pythonProfile, [
      'def check(',
      '    client,  # who asks',
      '    # where',
      '    path,',
      '):',
      '    return client + path',
    ]);
    expect(signature(py.symbols, 'check')).toBe('def check(client, path)');
  });

  it('caps a long multi-line signature and leaves multi-line values alone', async () => {
    const params = Array.from({ length: 30 }, (_, i) => `  parameterNumber${i}: string,`);
    const { symbols } = await extract('.ts', tsProfile, [
      'export function wide(',
      ...params,
      '): void {}',
      'export const table = build(',
      '  1,',
      '  2,',
      ');',
    ]);
    const wide = signature(symbols, 'wide')!;
    expect(wide.length).toBe(MAX_SIGNATURE_LENGTH);
    expect(wide.startsWith('function wide(parameterNumber0: string, parameterNumber1: string,')).toBe(true);
    expect(wide).not.toContain('\n');
    // Not a parameter list: a multi-line call is not pulled into the signature.
    expect(signature(symbols, 'table')).toBe('table = build(');
  });
});

// ---------------------------------------------------------------------------
// 6. Property-assigned functions (extraction side)
// ---------------------------------------------------------------------------

describe('M1-08 item 6: property-assigned functions are flagged', () => {
  it('flags functions assigned to object keys and to properties, and nothing else', async () => {
    const { symbols } = await extract('.js', tsProfile, [
      'function declared() {}',
      'const arrow = () => 1;',
      'const handlers = { onClick: () => 1, onKey: function () {} };',
      'handlers.onHover = function () {};',
      'exports.shared = () => 2;',
      'let late;',
      'late = function () {};',
      'class Widget {',
      '  render() {}',
      '}',
    ]);
    const flags = Object.fromEntries(symbols.map((s) => [`${s.kind}:${s.name}`, s.is_property]));
    expect(flags).toEqual({
      'function:declared': 0,
      'function:arrow': 0,
      'variable:handlers': 0,
      'function:onClick': 1,
      'function:onKey': 1,
      'function:onHover': 1,
      'function:shared': 1,
      'variable:late': 0,
      'function:late': 0,
      'class:Widget': 0,
      'method:render': 0,
    });
  });

  it('never flags Python or Go symbols', async () => {
    const py = await extract('.py', pythonProfile, ['A = 1', 'def f():', '    return A']);
    const go = await extract('.go', goProfile, ['package demo', '', 'func F() int { return 1 }']);
    expect([...py.symbols, ...go.symbols].map((s) => s.is_property)).toEqual([0, 0, 0]);
  });
});
