import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile, type ExtractedSymbol } from '../../../src/parsers/core';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { pythonProfile } from '../../../src/parsers/profiles/python';
import { goProfile } from '../../../src/parsers/profiles/go';
import type { LanguageProfile } from '../../../src/parsers/language-profile';
import { INDEX_SCHEMA_VERSION } from '../../../src/stores/sqlite';

/**
 * TypeScript, Python and Go through the tags-query engine: what the vendored
 * queries, Hesman's gap fillers and the documented profile overrides produce.
 * The fixtures' golden sets are covered by golden-symbols.test.ts; this file
 * pins the behavior the fixtures do not exercise.
 */
describe('profiles on the tags engine', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hesman-tags-migration-'));

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function symbolsOf(name: string, source: string, profile: LanguageProfile): Promise<ExtractedSymbol[]> {
    const file = join(tmp, name);
    writeFileSync(file, source);
    return (await parseFile(file, profile)).symbols;
  }

  const brief = (symbols: ExtractedSymbol[]): Array<[string, string, number]> =>
    symbols.map((s) => [s.name, s.kind, s.start_line]);

  it('profiles carry no hand-written symbol tables or signature extractors', () => {
    for (const profile of [tsProfile, pythonProfile, goProfile]) {
      expect(profile).not.toHaveProperty('symbolNodeTypes');
      expect(profile).not.toHaveProperty('extractSignature');
    }
    // Documented overrides only (reasons are in the profile files).
    expect(tsProfile.extractDocComment).toBeUndefined();
    expect(goProfile.extractDocComment).toBeUndefined();
    expect(goProfile.includeDefinition).toBeUndefined();
    expect(pythonProfile.includeDefinition).toBeUndefined();
    expect(typeof pythonProfile.extractDocComment).toBe('function');
    expect(typeof tsProfile.includeDefinition).toBe('function');
  });

  it('rebuilds indexes written by the hand-written profiles (the symbol set changed)', () => {
    expect(INDEX_SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
  });

  describe('TypeScript', () => {
    const SOURCE = [
      /*  1 */ 'export type Id = string | number;',
      /*  2 */ 'export enum Color { Red, Green }',
      /*  3 */ 'namespace Geometry { export const unit = 1; }',
      /*  4 */ '/** Doubles a number. */',
      /*  5 */ 'export const double = (n: number): number => n * 2;',
      /*  6 */ 'export const limit = 10;',
      /*  7 */ 'const { a, b } = { a: 1, b: 2 };',
      /*  8 */ 'export interface Shape {',
      /*  9 */ '  area(): number;',
      /* 10 */ '}',
      /* 11 */ 'export function pick(x: string): string;',
      /* 12 */ 'export function pick(x: number): number;',
      /* 13 */ 'export function pick(x: unknown): unknown { return x; }',
      /* 14 */ 'export abstract class Base {',
      /* 15 */ '  abstract area(): number;',
      /* 16 */ '}',
      /* 17 */ 'export class Circle extends Base implements Shape {',
      /* 18 */ '  constructor(private r: number) { super(); }',
      /* 19 */ '  // Area of the circle.',
      /* 20 */ '  area(): number { return 3 * this.r; }',
      /* 21 */ '  #secret(): void {}',
      /* 22 */ '}',
      '',
    ].join('\n');

    it('extracts definitions from the layered queries', async () => {
      const symbols = await symbolsOf('sample.ts', SOURCE, tsProfile);
      expect(brief(symbols)).toEqual([
        ['Id', 'type', 1],
        ['Color', 'enum', 2],
        ['Geometry', 'namespace', 3],
        ['unit', 'variable', 3],
        ['double', 'function', 5],
        ['limit', 'variable', 6],
        ['Shape', 'interface', 8],
        ['pick', 'function', 13],
        ['Base', 'class', 14],
        ['Circle', 'class', 17],
        ['constructor', 'method', 18],
        ['area', 'method', 20],
        ['#secret', 'method', 21],
      ]);
    });

    it('skips body-less signatures so an implementation keeps a unique name (override hook)', async () => {
      const symbols = await symbolsOf('sample.ts', SOURCE, tsProfile);
      expect(symbols.filter((s) => s.name === 'pick')).toHaveLength(1);
      expect(symbols.filter((s) => s.name === 'area')).toHaveLength(1);
    });

    it('links members to their container and keeps export detection', async () => {
      const symbols = await symbolsOf('sample.ts', SOURCE, tsProfile);
      const byName = (name: string): ExtractedSymbol => symbols.find((s) => s.name === name)!;
      expect(byName('area').parent_id).toBe(byName('Circle').id);
      expect(byName('constructor').parent_id).toBe(byName('Circle').id);
      expect(byName('unit').parent_id).toBe(byName('Geometry').id);
      expect(byName('Circle').parent_id).toBeNull();
      expect(byName('double').is_exported).toBe(1);
      expect(byName('Geometry').is_exported).toBe(0);
    });

    it('uses the generic signature and doc-comment helpers', async () => {
      const symbols = await symbolsOf('sample.ts', SOURCE, tsProfile);
      const byName = (name: string): ExtractedSymbol => symbols.find((s) => s.name === name)!;
      expect(byName('double').signature).toBe('double = (n: number): number => n * 2');
      expect(byName('double').doc_comment).toBe('Doubles a number.');
      expect(byName('area').signature).toBe('area(): number');
      expect(byName('area').doc_comment).toBe('Area of the circle.');
      expect(byName('Circle').signature).toBe('class Circle extends Base implements Shape');
      expect(byName('limit').doc_comment).toBeNull();
    });

    it('parses JavaScript files with the same queries', async () => {
      const symbols = await symbolsOf(
        'sample.js',
        [
          'class A { run() {} }',
          'function f() {}',
          'const g = function () {};',
          'module.exports.h = () => 1;',
          'const handlers = { onClick: () => 1 };',
          'const K = class Named {};',
          '',
        ].join('\n'),
        tsProfile,
      );
      expect(brief(symbols)).toEqual([
        ['A', 'class', 1],
        ['run', 'method', 1],
        ['f', 'function', 2],
        ['g', 'function', 3],
        ['h', 'function', 4],
        ['handlers', 'variable', 5],
        ['onClick', 'function', 5],
        ['K', 'variable', 6],
        ['Named', 'class', 6],
      ]);
    });
  });

  describe('Python', () => {
    const SOURCE = [
      /*  1 */ 'LIMIT = 10',
      /*  2 */ '',
      /*  3 */ '# Formats a name.',
      /*  4 */ 'def fmt(name):',
      /*  5 */ '    return name',
      /*  6 */ '',
      /*  7 */ '@dataclass',
      /*  8 */ 'class User:',
      /*  9 */ '    """A user.',
      /* 10 */ '',
      /* 11 */ '    With a name.',
      /* 12 */ '    """',
      /* 13 */ '    def greet(',
      /* 14 */ '        self,',
      /* 15 */ '    ):',
      /* 16 */ "        '''Greets.'''",
      /* 17 */ '        local = 1',
      /* 18 */ '        return local',
      '',
    ].join('\n');

    it('extracts module constants, classes and functions', async () => {
      const symbols = await symbolsOf('sample.py', SOURCE, pythonProfile);
      expect(brief(symbols)).toEqual([
        ['LIMIT', 'constant', 1],
        ['fmt', 'function', 4],
        ['User', 'class', 8],
        ['greet', 'function', 13],
      ]);
      expect(symbols.find((s) => s.name === 'greet')!.parent_id).toBe(symbols.find((s) => s.name === 'User')!.id);
    });

    it('reads docstrings through the profile override, comments above otherwise', async () => {
      const symbols = await symbolsOf('sample.py', SOURCE, pythonProfile);
      const byName = (name: string): ExtractedSymbol => symbols.find((s) => s.name === name)!;
      expect(byName('User').doc_comment).toBe('A user.\nWith a name.');
      expect(byName('greet').doc_comment).toBe('Greets.');
      expect(byName('fmt').doc_comment).toBe('Formats a name.');
      expect(byName('LIMIT').doc_comment).toBeNull();
    });

    it('uses the generic signature helper', async () => {
      const symbols = await symbolsOf('sample.py', SOURCE, pythonProfile);
      const byName = (name: string): ExtractedSymbol => symbols.find((s) => s.name === name)!;
      expect(byName('User').signature).toBe('class User');
      expect(byName('fmt').signature).toBe('def fmt(name)');
      expect(byName('greet').signature).toBe('def greet(');
      expect(byName('LIMIT').signature).toBe('LIMIT = 10');
    });
  });

  describe('Go', () => {
    const SOURCE = [
      /*  1 */ 'package demo',
      /*  2 */ '',
      /*  3 */ 'const A, b = 1, 2',
      /*  4 */ '',
      /*  5 */ 'var (',
      /*  6 */ '\t// Count counts.',
      /*  7 */ '\tCount = 0',
      /*  8 */ ')',
      /*  9 */ '',
      /* 10 */ '// Shape has an area.',
      /* 11 */ 'type Shape interface {',
      /* 12 */ '\tArea() float64',
      /* 13 */ '}',
      /* 14 */ '',
      /* 15 */ 'func Run() {',
      /* 16 */ '\tvar local int',
      /* 17 */ '\t_ = local',
      /* 18 */ '}',
      '',
    ].join('\n');

    it('extracts constants and variables through the Hesman gap query', async () => {
      const symbols = await symbolsOf('sample.go', SOURCE, goProfile);
      expect(brief(symbols)).toEqual([
        ['A', 'constant', 3],
        ['b', 'constant', 3],
        ['Count', 'variable', 7],
        ['Shape', 'type', 11],
        ['Run', 'function', 15],
        ['local', 'variable', 16],
      ]);
    });

    it('keeps Go export rules and generic doc comments', async () => {
      const symbols = await symbolsOf('sample.go', SOURCE, goProfile);
      const byName = (name: string): ExtractedSymbol => symbols.find((s) => s.name === name)!;
      expect(byName('A').is_exported).toBe(1);
      expect(byName('b').is_exported).toBe(0);
      expect(byName('local').is_exported).toBe(0);
      expect(byName('Count').doc_comment).toBe('Count counts.');
      expect(byName('Shape').doc_comment).toBe('Shape has an area.');
      expect(byName('Shape').signature).toBe('Shape interface');
      expect(byName('Run').signature).toBe('func Run()');
    });
  });
});
