import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from '../../../src/parsers/core';
import { languageForPath, profileFor } from '../../../src/parsers/languages';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', '..', 'fixtures');
const GOLDEN = resolve(__dirname, 'golden');

/** [file, name, kind, startLine, endLine, isExported] */
type Row = [string, string, string, number, number, number];

/**
 * Golden symbol sets (M1-02).
 *
 * `golden/<fixture>.json` was recorded with the hand-written profiles, before
 * TypeScript, Python and Go moved to the tags-query engine. Symbol ids are
 * derived from (file, name, kind, start line), so equality here also means the
 * ids did not change. Any intended difference must be listed in
 * `EXPECTED_DIFFERENCES` with its reason and in the task's progress notes.
 */
const EXPECTED_DIFFERENCES: Record<string, { added: Row[]; removed: Row[] }> = {
  // M1-08: `result` and `calc` are local variables of the exported function
  // `main` (src/index.ts lines 9-10). They were reported as exported because
  // any enclosing `export` counted; a declaration inside a function is local.
  'ts-basic': {
    added: [
      ['src/index.ts', 'result', 'variable', 9, 9, 0],
      ['src/index.ts', 'calc', 'variable', 10, 10, 0],
    ],
    removed: [
      ['src/index.ts', 'result', 'variable', 9, 9, 1],
      ['src/index.ts', 'calc', 'variable', 10, 10, 1],
    ],
  },
  'py-basic': { added: [], removed: [] },
  'go-basic': { added: [], removed: [] },
  'polyglot-basic': { added: [], removed: [] },
};

/**
 * Parses the files named in the golden set. The fixture directory is not
 * scanned: other test files create temporary sources inside the fixtures while
 * the suite runs in parallel.
 */
async function extract(fixture: string, files: string[]): Promise<Row[]> {
  const root = join(FIXTURES, fixture);
  const rows: Row[] = [];
  for (const file of files) {
    const path = join(root, file);
    const profile = profileFor(languageForPath(path)!)!;
    const result = await parseFile(path, profile);
    for (const s of result.symbols) {
      rows.push([file, s.name, s.kind, s.start_line, s.end_line, s.is_exported]);
    }
  }
  return rows;
}

const key = (row: Row): string => JSON.stringify(row);

describe('golden symbol sets', () => {
  it.each(Object.keys(EXPECTED_DIFFERENCES))('%s: the engine reproduces the recorded symbols', async (fixture) => {
    const golden = JSON.parse(readFileSync(join(GOLDEN, `${fixture}.json`), 'utf-8')) as Row[];
    expect(golden.length).toBeGreaterThan(0);
    const { added, removed } = EXPECTED_DIFFERENCES[fixture];

    const removedKeys = new Set(removed.map(key));
    const expected = [...golden.filter((row) => !removedKeys.has(key(row))), ...added].map(key).sort();
    const files = [...new Set(golden.map((row) => row[0]))];
    const actual = (await extract(fixture, files)).map(key).sort();

    expect(actual).toEqual(expected);
  });
});
