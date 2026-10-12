import { describe, it, expect, beforeAll } from 'vitest';
import { initParser, parseFile } from '../../../src/parsers/core';
import { extractRelations } from '../../../src/parsers/relation-extractor';
import { goProfile } from '../../../src/parsers/profiles/go';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'go-basic');

describe('Go relation extraction', () => {
  beforeAll(async () => {
    await initParser(goProfile);
  });

  it('extracts CALLS relations from function calls', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'server.go'), goProfile);
    const rels = extractRelations(
      result.symbols,
      '',
      resolve(FIXTURE_DIR, 'server.go'),
      goProfile,
      result.references,
    );
    const calls = rels.filter((r) => r.kind === 'calls');
    // NewServer calls `fmt.Sprintf`, Start calls `fmt.Sprintf`, Stop calls `fmt.Println`
    expect(calls.length).toBeGreaterThan(0);
  });

  it('extracts CALLS relations from main.go', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.go'), goProfile);
    const rels = extractRelations(
      result.symbols,
      '',
      resolve(FIXTURE_DIR, 'main.go'),
      goProfile,
      result.references,
    );
    const calls = rels.filter((r) => r.kind === 'calls');
    // main() calls `add` and `fmt.Println`
    const callLines = calls.map((c) => c.line);
    expect(callLines.length).toBeGreaterThan(0);
  });

  it('extracts IMPORTS relations from import statements', async () => {
    const result = await parseFile(resolve(FIXTURE_DIR, 'server.go'), goProfile);
    const rels = extractRelations(
      result.symbols,
      '',
      resolve(FIXTURE_DIR, 'server.go'),
      goProfile,
      result.references,
    );
    const imports = rels.filter((r) => r.kind === 'imports');
    // server.go line 3: `import "fmt"` (read from the syntax tree, M1-07).
    expect(imports.map((r) => `${r.to_id}@${r.line}`)).toEqual(['unresolved:fmt@3']);
  });

  it('returns empty array for profile without relation queries', async () => {
    const noQueryProfile = { ...goProfile, relationQueries: undefined };
    const result = await parseFile(resolve(FIXTURE_DIR, 'main.go'), noQueryProfile);
    const rels = extractRelations(
      result.symbols,
      '',
      resolve(FIXTURE_DIR, 'main.go'),
      noQueryProfile,
      result.references,
    );
    expect(rels).toEqual([]);
  });
});
