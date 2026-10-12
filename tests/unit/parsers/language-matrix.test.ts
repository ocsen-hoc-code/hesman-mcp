/**
 * The language table of README.md is generated from the registries (M1-06),
 * so it cannot claim support the code does not have. The project has no CI:
 * this test is the check that fails while the committed table is stale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MATRIX_END,
  MATRIX_START,
  renderLanguageMatrix,
  replaceLanguageMatrix,
} from '../../../scripts/generate-language-matrix';
import { LANGUAGES } from '../../../src/parsers/languages';
import { ON_DEMAND_LANGUAGES } from '../../../src/parsers/on-demand-languages';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const README = join(REPO, 'README.md');
const FIX = 'README.md language matrix is stale. Run: npx tsx scripts/generate-language-matrix.ts';

describe('README language matrix', () => {
  const rows = renderLanguageMatrix().split('\n');

  it('has one row per bundled and on-demand language plus the text tier, in registry order', () => {
    expect(rows.slice(0, 2)).toEqual([
      '| Language | Extensions | Tier | Grammar | What works |',
      '|---|---|---|---|---|',
    ]);
    expect(rows).toHaveLength(2 + LANGUAGES.length + ON_DEMAND_LANGUAGES.length + 1);
    expect(rows[2]).toBe('| TypeScript | `.ts`, `.mts`, `.cts` | deep | bundled | Symbols, call graph, impact analysis |');
    expect(rows.at(-1)).toMatch(/^\| Everything else \| any text file \| text \| none \| /);
  });

  it('states the tier, the extensions and the grammar source of the registry entry', () => {
    const body = rows.slice(2);
    [...LANGUAGES, ...ON_DEMAND_LANGUAGES].forEach((def, index) => {
      const cells = body[index].split('|').map((cell) => cell.trim());
      expect(cells[2], def.id).toBe(def.extensions.map((ext) => `\`${ext}\``).join(', '));
      expect(cells[3], def.id).toBe(def.tier);
      expect(cells[4], def.id).toBe(index < LANGUAGES.length ? 'bundled' : 'on demand');
      expect(cells[5], def.id).toBe(def.tier === 'deep' ? 'Symbols, call graph, impact analysis' : 'Symbols only (no call graph)');
    });
  });

  it('names an on-demand language', () => {
    expect(rows).toContain('| R | `.r` | structural | on demand | Symbols only (no call graph) |');
  });

  it('replaces only what is between the markers', () => {
    const before = `# Title\n\nprose\n\n${MATRIX_START}\nold table\n${MATRIX_END}\n\nmore prose\n`;
    expect(replaceLanguageMatrix(before)).toBe(
      `# Title\n\nprose\n\n${MATRIX_START}\n${renderLanguageMatrix()}\n${MATRIX_END}\n\nmore prose\n`,
    );
  });

  it('refuses a README without the markers', () => {
    expect(() => replaceLanguageMatrix('# Title\n')).toThrow(/language-matrix:start/);
  });

  it('is up to date in README.md', () => {
    const readme = readFileSync(README, 'utf-8');
    expect(replaceLanguageMatrix(readme) === readme, FIX).toBe(true);
  });
});
