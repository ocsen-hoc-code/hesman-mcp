/**
 * The per-language list of `index_status` (M1-06): every language in the
 * index with its support tier, so an agent can tell "no callers" from
 * "no call extraction for this language".
 */
import { describe, it, expect } from 'vitest';
import { grammarReport, supportTier } from '../../../src/parsers/grammar-report';
import { grammarStore } from '../../../src/parsers/grammar-store';
import { LANGUAGES } from '../../../src/parsers/languages';
import { ON_DEMAND_LANGUAGES } from '../../../src/parsers/on-demand-languages';

describe('supportTier', () => {
  it('is the registry tier of every bundled language', () => {
    for (const def of LANGUAGES) expect(supportTier(def.id), def.id).toBe(def.tier);
  });

  it('is structural for every on-demand language', () => {
    expect(ON_DEMAND_LANGUAGES.length).toBeGreaterThan(0);
    for (const def of ON_DEMAND_LANGUAGES) expect(supportTier(def.id), def.id).toBe('structural');
  });

  it('is structural for a parsed language the registries no longer know', () => {
    expect(supportTier('no-such-language')).toBe('structural');
  });
});

describe('grammarReport', () => {
  it('lists parsed languages with their support tier and text-tier languages as text', () => {
    const report = grammarReport(
      [{ language: 'typescript', files: 3 }, { language: 'r', files: 2 }],
      [{ language: 'markdown', files: 1 }, { language: 'cobol', files: 4 }],
      grammarStore(),
    );
    expect(report.languages.map(({ language, tier, files }) => ({ language, tier, files }))).toEqual([
      { language: 'typescript', tier: 'deep', files: 3 },
      { language: 'r', tier: 'structural', files: 2 },
      { language: 'markdown', tier: 'text', files: 1 },
      { language: 'cobol', tier: 'text', files: 4 },
    ]);
  });
});
