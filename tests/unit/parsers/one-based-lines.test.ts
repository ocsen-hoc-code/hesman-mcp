import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initParser, parseFile } from '../../../src/parsers/core';
import { extractRelations } from '../../../src/parsers/relation-extractor';
import { chunkSymbols } from '../../../src/parsers/chunker';
import { pythonProfile } from '../../../src/parsers/profiles/python';
import { tsProfile as typescriptProfile } from '../../../src/parsers/profiles/typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLYGLOT = resolve(__dirname, '..', '..', 'fixtures', 'polyglot-basic');

describe('parsers store 1-based, inclusive line numbers', () => {
  let tmp: string;

  beforeAll(async () => {
    await initParser(pythonProfile);
    await initParser(typescriptProfile);
    tmp = mkdtempSync(join(tmpdir(), 'hesman-one-based-'));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('symbol start_line/end_line match the file lines', async () => {
    const result = await parseFile(join(POLYGLOT, 'py', 'greet.py'), pythonProfile);
    const fmt = result.symbols.find((s) => s.name === 'py_format_name');
    const greet = result.symbols.find((s) => s.name === 'py_greet');
    expect(fmt).toMatchObject({ start_line: 1, end_line: 2 });
    expect(greet).toMatchObject({ start_line: 5, end_line: 6 });
  });

  it('relation lines are 1-based', async () => {
    const file = join(POLYGLOT, 'ts', 'greet.ts');
    const result = await parseFile(file, typescriptProfile);
    const rels = extractRelations(result.symbols, '', file, typescriptProfile);
    const greet = result.symbols.find((s) => s.name === 'tsGreet');
    const fmt = result.symbols.find((s) => s.name === 'tsFormatName');
    const calls = rels.filter((r) => r.kind === 'calls' && r.from_id === greet?.id && r.to_id === fmt?.id);
    // Filter on both ends: the regex extractor also records declarations as
    // self-calls (M0-13 fixes that).
    expect(calls).toHaveLength(1);
    const call = calls[0];
    // `tsFormatName(name)` is called on file line 6.
    expect(call?.line).toBe(6);
  });

  it('parse-error lines are 1-based', async () => {
    const file = join(tmp, 'broken.ts');
    writeFileSync(file, 'const ok = 1;\n\nfunction (((( {\n');
    const result = await parseFile(file, typescriptProfile);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].line).toBe(3);
    expect(result.errors[0].message).toContain('line 3');
  });

  it('chunker slices the symbol lines with 1-based bounds', async () => {
    const file = join(POLYGLOT, 'py', 'greet.py');
    const result = await parseFile(file, pythonProfile);
    const greet = result.symbols.filter((s) => s.name === 'py_greet');
    const lines = ['def py_format_name(name: str) -> str:', '    return name.strip()', '', '',
      'def py_greet(name: str) -> str:', '    return f"Hello, {py_format_name(name)}!"'];
    const [chunk] = chunkSymbols(greet, lines);
    expect(chunk.text).toContain('def py_greet(name: str) -> str:\n    return f"Hello');
    expect(chunk.text).not.toContain('return name.strip()');
  });
});
