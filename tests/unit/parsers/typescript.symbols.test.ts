import { describe, it, expect, beforeAll } from 'vitest';
import { initParser, parseFile } from '../../../src/parsers/core';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'ts-basic');

describe('TypeScript parser — symbol extraction', () => {
  beforeAll(async () => {
    await initParser(tsProfile);
  });

  it('parses a TypeScript file without error', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/utils.ts'), tsProfile);
    expect(result.language).toBe('typescript');
    expect(result.parseQuality).toBe('full');
    expect(result.symbols.length).toBeGreaterThan(0);
  });

  it('extracts exported functions', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/utils.ts'), tsProfile);
    const funcs = result.symbols.filter((s) => s.kind === 'function');
    const names = funcs.map((s) => s.name);
    expect(names).toContain('add');
    expect(names).toContain('formatName');
  });

  it('marks exported symbols correctly', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/utils.ts'), tsProfile);
    const addSymbol = result.symbols.find((s) => s.name === 'add');
    expect(addSymbol?.is_exported).toBe(1);
    const formatSymbol = result.symbols.find((s) => s.name === 'formatName');
    expect(formatSymbol?.is_exported).toBe(0);
  });

  it('extracts interface declarations', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/utils.ts'), tsProfile);
    const interfaces = result.symbols.filter((s) => s.kind === 'interface');
    expect(interfaces.map((s) => s.name)).toContain('Person');
  });

  it('extracts class declarations', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/utils.ts'), tsProfile);
    const classes = result.symbols.filter((s) => s.kind === 'class');
    expect(classes.map((s) => s.name)).toContain('Calculator');
  });

  it('extracts class methods', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/utils.ts'), tsProfile);
    const methods = result.symbols.filter((s) => s.kind === 'method');
    const names = methods.map((s) => s.name);
    expect(names).toContain('add');
    expect(names).toContain('getValue');
    expect(names).toContain('constructor');
    // Methods should have a parent_id pointing to the class
    for (const m of methods) {
      expect(m.parent_id).toBeTruthy();
    }
  });

  it('generates stable symbol IDs', async () => {
    const result1 = await parseFile(resolve(FIXTURE_DIR, 'src/utils.ts'), tsProfile);
    const result2 = await parseFile(resolve(FIXTURE_DIR, 'src/utils.ts'), tsProfile);
    const ids1 = result1.symbols.map((s) => s.id).sort();
    const ids2 = result2.symbols.map((s) => s.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it('handles files with type aliases and const exports', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/index.ts'), tsProfile);
    const types = result.symbols.filter((s) => s.kind === 'type');
    expect(types.map((s) => s.name)).toContain('Status');
    const variables = result.symbols.filter((s) => s.kind === 'variable');
    expect(variables.map((s) => s.name)).toContain('VERSION');
  });
});
