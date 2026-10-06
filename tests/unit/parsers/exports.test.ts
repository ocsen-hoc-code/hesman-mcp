import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initParser, parseFile, type ExtractedSymbol } from '../../../src/parsers/core';
import { goProfile } from '../../../src/parsers/profiles/go';
import { pythonProfile } from '../../../src/parsers/profiles/python';
import { tsProfile } from '../../../src/parsers/profiles/typescript';

let dir: string;

function exportedByName(symbols: ExtractedSymbol[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of symbols) out[`${s.kind}:${s.name}`] = s.is_exported;
  return out;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hesman-exports-'));
  await initParser(goProfile);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isExported — Go (exported iff the identifier starts with an uppercase letter)', () => {
  it('marks capitalized top-level declarations exported and lowercase ones not', async () => {
    const file = join(dir, 'pkg.go');
    writeFileSync(
      file,
      [
        'package pkg',
        '',
        'const Version = "1"',
        'const internalVersion = "1"',
        'var DefaultName = "x"',
        'var counter = 0',
        'type Server struct{}',
        'type config struct{}',
        'func NewServer() *Server { return &Server{} }',
        'func helper() {}',
        'func (s *Server) Start() {}',
        'func (s *Server) stop() {}',
        'func Ünicode() {}',
        'func _Hidden() {}',
        '',
      ].join('\n'),
    );
    const { symbols } = await parseFile(file, goProfile);
    const exp = exportedByName(symbols);
    expect(exp['constant:Version']).toBe(1);
    expect(exp['constant:internalVersion']).toBe(0);
    expect(exp['variable:DefaultName']).toBe(1);
    expect(exp['variable:counter']).toBe(0);
    expect(exp['type:Server']).toBe(1);
    expect(exp['type:config']).toBe(0);
    expect(exp['function:NewServer']).toBe(1);
    expect(exp['function:helper']).toBe(0);
    expect(exp['method:Start']).toBe(1);
    expect(exp['method:stop']).toBe(0);
    expect(exp['function:Ünicode']).toBe(1);
    expect(exp['function:_Hidden']).toBe(0);
  });

  it('does not mark declarations local to a function body as exported', async () => {
    const file = join(dir, 'local.go');
    writeFileSync(
      file,
      [
        'package pkg',
        '',
        'func Run() {',
        '\tconst Limit = 3',
        '\tvar Total = 0',
        '\ttype Local struct{}',
        '\t_ = Total',
        '}',
        '',
      ].join('\n'),
    );
    const { symbols } = await parseFile(file, goProfile);
    const exp = exportedByName(symbols);
    expect(exp['function:Run']).toBe(1);
    expect(exp['constant:Limit']).toBe(0);
    expect(exp['variable:Total']).toBe(0);
    expect(exp['type:Local']).toBe(0);
  });
});

describe('isExported — Python (public unless "_"-prefixed; dunders are public)', () => {
  it('marks public module-level and class members exported, private ones not', async () => {
    const file = join(dir, 'mod.py');
    writeFileSync(
      file,
      [
        'def greet():',
        '    def inner():',
        '        pass',
        '    return inner',
        '',
        'def _private():',
        '    pass',
        '',
        'class Greeter:',
        '    def __init__(self):',
        '        pass',
        '',
        '    def hello(self):',
        '        pass',
        '',
        '    def _secret(self):',
        '        pass',
        '',
        'class _Hidden:',
        '    pass',
        '',
      ].join('\n'),
    );
    const { symbols } = await parseFile(file, pythonProfile);
    const byName = (name: string) => symbols.find((s) => s.name === name)?.is_exported;
    expect(byName('greet')).toBe(1);
    expect(byName('inner')).toBe(0);
    expect(byName('_private')).toBe(0);
    expect(byName('Greeter')).toBe(1);
    expect(byName('__init__')).toBe(1);
    expect(byName('hello')).toBe(1);
    expect(byName('_secret')).toBe(0);
    expect(byName('_Hidden')).toBe(0);
  });
});

describe('isExported — TypeScript (unchanged: requires an export statement)', () => {
  it('marks exported declarations only', async () => {
    const file = join(dir, 'mod.ts');
    writeFileSync(file, 'export function pub(): void {}\nfunction priv(): void {}\n');
    const { symbols } = await parseFile(file, tsProfile);
    const byName = (name: string) => symbols.find((s) => s.name === name)?.is_exported;
    expect(byName('pub')).toBe(1);
    expect(byName('priv')).toBe(0);
  });
});
