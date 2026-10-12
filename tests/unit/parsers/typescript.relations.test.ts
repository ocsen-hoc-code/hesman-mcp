import { describe, it, expect, beforeAll } from 'vitest';
import { initParser, parseFile } from '../../../src/parsers/core';
import { extractRelations } from '../../../src/parsers/relation-extractor';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'ts-basic');

describe('TypeScript relation extraction', () => {
  beforeAll(async () => {
    await initParser(tsProfile);
  });

  it('extracts CALLS from function call expressions', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/index.ts'), tsProfile);
    const rels = extractRelations(result.symbols, '', resolve(FIXTURE_DIR, 'src/index.ts'), tsProfile, result.references);
    const calls = rels.filter(r => r.kind === 'calls');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('extracts IMPORTS from import statements', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/index.ts'), tsProfile);
    const rels = extractRelations(result.symbols, '', resolve(FIXTURE_DIR, 'src/index.ts'), tsProfile, result.references);
    const imports = rels.filter(r => r.kind === 'imports');
    expect(imports.length).toBeGreaterThan(0);
  });

  it('returns empty array for profile without relation queries', async () => {
    const noQueryProfile = { ...tsProfile, relationQueries: undefined };
    const result = await parseFile(resolve(FIXTURE_DIR, 'src/index.ts'), noQueryProfile);
    const rels = extractRelations(result.symbols, '', resolve(FIXTURE_DIR, 'src/index.ts'), noQueryProfile, result.references);
    expect(rels).toEqual([]);
  });
});
