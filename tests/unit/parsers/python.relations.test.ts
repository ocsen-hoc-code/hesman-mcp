import { describe, it, expect, beforeAll } from 'vitest';
import { initParser, parseFile } from '../../../src/parsers/core';
import { extractRelations } from '../../../src/parsers/relation-extractor';
import { pythonProfile } from '../../../src/parsers/profiles/python';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'py-basic');

describe('Python relation extraction', () => {
  beforeAll(async () => {
    await initParser(pythonProfile);
  });

  it('extracts CALLS relations from function calls', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), pythonProfile);
    const rels = extractRelations(
      result.symbols,
      '',
      resolve(FIXTURE_DIR, 'main.py'),
      pythonProfile,
      result.references,
    );
    const calls = rels.filter((r) => r.kind === 'calls');
    // Calculator.add(self, n) calls the standalone add() function
    expect(calls.length).toBeGreaterThan(0);
  });

  it('extracts IMPORTS relations from import statements', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'utils.py'), pythonProfile);
    const rels = extractRelations(
      result.symbols,
      '',
      resolve(FIXTURE_DIR, 'utils.py'),
      pythonProfile,
      result.references,
    );
    const imports = rels.filter((r) => r.kind === 'imports');
    // utils.py line 3: `from typing import List, Optional` (read from the syntax tree, M1-07).
    expect(imports.map((r) => `${r.to_id}@${r.line}`)).toEqual(['unresolved:typing@3']);
  });

  it('returns empty array for profile without relation queries', async () => {
    const noQueryProfile = { ...pythonProfile, relationQueries: undefined };
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.py'), noQueryProfile);
    const rels = extractRelations(
      result.symbols,
      '',
      resolve(FIXTURE_DIR, 'main.py'),
      noQueryProfile,
      result.references,
    );
    expect(rels).toEqual([]);
  });
});
