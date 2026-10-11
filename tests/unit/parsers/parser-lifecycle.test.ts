import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Parser, Tree } from 'web-tree-sitter';
import { parseFile } from '../../../src/parsers/core';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { goProfile } from '../../../src/parsers/profiles/go';

describe('parser lifecycle (WASM memory)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hesman-parser-lifecycle-'));
  const tsFile = join(tmp, 'a.ts');
  const goFile = join(tmp, 'a.go');
  writeFileSync(tsFile, 'export function a(): number { return 1; }\n');
  writeFileSync(goFile, 'package a\n\nfunc A() int { return 1 }\n');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reuses one Parser per language instead of creating one per file', async () => {
    // Warm up so both languages already own their parser.
    await parseFile(tsFile, tsProfile);
    await parseFile(goFile, goProfile);

    const setLanguage = vi.spyOn(Parser.prototype, 'setLanguage');
    for (let i = 0; i < 5; i++) {
      await parseFile(tsFile, tsProfile);
      await parseFile(goFile, goProfile);
    }
    expect(setLanguage).not.toHaveBeenCalled();
  });

  it('deletes the syntax tree after extraction', async () => {
    const del = vi.spyOn(Tree.prototype, 'delete');
    const result = await parseFile(tsFile, tsProfile);
    expect(result.symbols.map((s) => s.name)).toEqual(['a']);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('still deletes the tree when the file has syntax errors', async () => {
    const broken = join(tmp, 'broken.ts');
    writeFileSync(broken, 'export function ( {\n');
    const del = vi.spyOn(Tree.prototype, 'delete');
    const result = await parseFile(broken, tsProfile);
    expect(result.parseQuality).toBe('partial');
    expect(del).toHaveBeenCalledTimes(1);
  });
});
