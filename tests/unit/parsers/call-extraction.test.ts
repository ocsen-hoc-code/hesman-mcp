import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initParser, parseFile, type ExtractedSymbol } from '../../../src/parsers/core';
import { extractRelations, type RelationRow } from '../../../src/parsers/relation-extractor';
import type { LanguageProfile } from '../../../src/parsers/language-profile';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { pythonProfile } from '../../../src/parsers/profiles/python';
import { goProfile } from '../../../src/parsers/profiles/go';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLYGLOT = resolve(__dirname, '..', '..', 'fixtures', 'polyglot-basic');

async function extract(file: string, profile: LanguageProfile): Promise<{ symbols: ExtractedSymbol[]; calls: RelationRow[] }> {
  const result = await parseFile(file, profile);
  const rels = extractRelations(result.symbols, '', file, profile, result.references);
  return { symbols: result.symbols, calls: rels.filter((r) => r.kind === 'calls') };
}

function byName(symbols: ExtractedSymbol[], name: string): ExtractedSymbol {
  const sym = symbols.find((s) => s.name === name);
  if (!sym) throw new Error(`symbol ${name} not extracted`);
  return sym;
}

describe('call extraction', () => {
  let tmp: string;

  beforeAll(async () => {
    await initParser(tsProfile);
    await initParser(pythonProfile);
    await initParser(goProfile);
    tmp = mkdtempSync(join(tmpdir(), 'hesman-calls-'));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it.each([
    ['ts/greet.ts', tsProfile],
    ['ts/main.ts', tsProfile],
    ['py/greet.py', pythonProfile],
    ['py/main.py', pythonProfile],
    ['go/greet.go', goProfile],
    ['go/main.go', goProfile],
  ] as const)('%s: a declaration line never produces a calls relation', async (rel, profile) => {
    const { symbols, calls } = await extract(join(POLYGLOT, rel), profile);
    for (const sym of symbols) {
      const atDeclaration = calls.filter(
        (c) => (c.to_name === sym.name || c.to_id === sym.id) && c.line === sym.start_line,
      );
      expect(atDeclaration).toEqual([]);
    }
  });

  it.each([
    ['go/main.go', goProfile, 'main', 'GoGreet', 6],
    ['ts/main.ts', tsProfile, 'tsMain', 'tsGreet', 4],
    ['py/main.py', pythonProfile, 'py_main', 'py_greet', 5],
  ] as const)('%s: records the call to a symbol defined in another file by name', async (rel, profile, caller, callee, line) => {
    const { symbols, calls } = await extract(join(POLYGLOT, rel), profile);
    const from = byName(symbols, caller);
    const call = calls.find((c) => c.from_id === from.id && c.to_name === callee);
    expect(call?.line).toBe(line);
  });

  it('attributes a call inside a method to the method, not the class', async () => {
    const file = join(tmp, 'method.ts');
    writeFileSync(file, [
      'export function helper(): number {',
      '  return 1;',
      '}',
      '',
      'export class Worker {',
      '  run(): number {',
      '    return helper();',
      '  }',
      '}',
    ].join('\n'));
    const { symbols, calls } = await extract(file, tsProfile);
    const run = byName(symbols, 'run');
    const toHelper = calls.filter((c) => c.to_name === 'helper');
    expect(toHelper).toHaveLength(1);
    expect(toHelper[0].from_id).toBe(run.id);
    expect(toHelper[0].line).toBe(7);
  });

  it('attributes a Python method call to the method, not the class', async () => {
    const file = join(tmp, 'method.py');
    writeFileSync(file, [
      'def helper():',
      '    return 1',
      '',
      '',
      'class Worker:',
      '    def run(self):',
      '        return helper()',
    ].join('\n'));
    const { symbols, calls } = await extract(file, pythonProfile);
    const run = byName(symbols, 'run');
    const toHelper = calls.filter((c) => c.to_name === 'helper');
    expect(toHelper).toHaveLength(1);
    expect(toHelper[0].from_id).toBe(run.id);
  });

  it('still records recursion (a function calling itself in its body)', async () => {
    const file = join(tmp, 'fact.ts');
    writeFileSync(file, [
      'export function fact(n: number): number {',
      '  return n <= 1 ? 1 : n * fact(n - 1);',
      '}',
    ].join('\n'));
    const { symbols, calls } = await extract(file, tsProfile);
    const fact = byName(symbols, 'fact');
    const self = calls.filter((c) => c.from_id === fact.id && c.to_name === 'fact');
    expect(self).toHaveLength(1);
    expect(self[0].line).toBe(2);
  });

  it('records recursion on the declaration line itself, but not the declaration', async () => {
    const file = join(tmp, 'oneline.ts');
    writeFileSync(file, 'export function f(n: number): number { return n ? f(n - 1) : 0; }\n');
    const { symbols, calls } = await extract(file, tsProfile);
    const f = byName(symbols, 'f');
    const self = calls.filter((c) => c.from_id === f.id && c.to_name === 'f');
    expect(self).toHaveLength(1);
    expect(self[0].col).toBeGreaterThan('export function f('.length);
  });
});
