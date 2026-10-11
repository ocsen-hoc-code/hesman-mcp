/**
 * Language conformance suite (M1-03).
 *
 * Iterates over the language registry and proves, for every entry, that the
 * language really works: its grammar loads in the pinned runtime, its vendored
 * queries compile against that grammar, its fixtures parse, the definitions
 * listed in `expected.json` are extracted with signatures and doc comments,
 * and (deep tier) the call relations are found.
 *
 * In v1.0 Python and Go indexed 0 files while every test passed. A language is
 * data now, so this suite is what turns a broken grammar, query or fixture into
 * a failure that names the language. The worker-pool + SQLite slice of the same
 * fixtures is `tests/integration/language-conformance.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION, Parser, type Language } from 'web-tree-sitter';
import { LANGUAGES } from '../../src/parsers/languages';
import { parseFile, type ExtractedSymbol } from '../../src/parsers/core';
import { extractRelations } from '../../src/parsers/relation-extractor';
import {
  ConformanceReport,
  DEFAULT_MAX_ERROR_NODES,
  KNOWN_TIERS,
  REPO,
  TIERS_WITH_CALLS,
  assertAll,
  assertSymbolDocumented,
  assertSymbolExtracted,
  callSubject,
  compileTagsQueries,
  countErrorNodes,
  gapFor,
  loadFixtureSet,
  loadGrammar,
  queryLayersOf,
  symbolSubject,
  unregisteredFixtureDirs,
  type FixtureSet,
} from './helpers';

const COLUMNS = ['grammar', 'queries', 'fixtures', 'parse', 'symbols', 'docs', 'calls'] as const;
const report = new ConformanceReport('Language conformance (in-process parser)', COLUMNS);

beforeAll(async () => {
  await Parser.init();
});

afterAll(() => {
  report.publish(LANGUAGES, 'conformance');
});

describe('language conformance: runtime and layout', () => {
  it('runs on the exact web-tree-sitter version pinned in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')) as { dependencies: Record<string, string> };
    const pinned = pkg.dependencies['web-tree-sitter'];
    const installed = (
      JSON.parse(readFileSync(join(REPO, 'node_modules', 'web-tree-sitter', 'package.json'), 'utf-8')) as { version: string }
    ).version;
    expect(pinned, 'web-tree-sitter must be pinned to an exact version').toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed, 'node_modules holds another web-tree-sitter than package.json pins; run npm ci').toBe(pinned);
  });

  it('registers at least one language', () => {
    expect(LANGUAGES.length).toBeGreaterThan(0);
  });

  it('has no fixture directory without a registry entry', () => {
    expect(
      unregisteredFixtureDirs(),
      'tests/fixtures/languages/<dir> must be the id of an entry in src/parsers/languages.ts',
    ).toEqual([]);
  });
});

for (const def of LANGUAGES) {
  describe(`language conformance: ${def.id}`, () => {
    const lang = def.id;
    let language: Language;

    beforeAll(async () => {
      language = await loadGrammar(def);
    });

    it(
      `[${lang}] grammar ${def.grammar} loads in the pinned runtime`,
      report.check(lang, 'grammar', async () => {
        const loaded = await loadGrammar(def);
        expect(
          loaded.abiVersion >= MIN_COMPATIBLE_VERSION && loaded.abiVersion <= LANGUAGE_VERSION,
          `[${lang}] parsers/${def.grammar} has ABI ${loaded.abiVersion}; the runtime accepts ${MIN_COMPATIBLE_VERSION}-${LANGUAGE_VERSION}`,
        ).toBe(true);
        const parser = new Parser();
        try {
          parser.setLanguage(loaded);
          const tree = parser.parse('');
          expect(tree, `[${lang}] parsers/${def.grammar} returned no tree`).not.toBeNull();
          tree?.delete();
        } finally {
          parser.delete();
        }
      }),
    );

    it(
      `[${lang}] declares a support tier`,
      report.check(lang, 'tier', () => {
        expect(
          KNOWN_TIERS.has(def.tier),
          `[${lang}] registry entry has no valid tier (found ${JSON.stringify(def.tier)}); ` +
            `declare tier: 'deep' | 'structural' in src/parsers/languages.ts`,
        ).toBe(true);
      }),
    );

    const layers = queryLayersOf(def);
    it(
      `[${lang}] has a tags query`,
      report.check(lang, 'queries', () => {
        expect(
          layers.length,
          `[${lang}] tier "${def.tier}" needs symbols, but the registry entry has no tagsQuery; ` +
            `vendor queries/${lang}/tags.scm and set tagsQuery in src/parsers/languages.ts`,
        ).toBeGreaterThan(0);
      }),
    );
    for (const layer of layers) {
      it(
        `[${lang}] query queries/${layer.name} compiles against ${def.grammar}`,
        report.check(lang, 'queries', () => compileTagsQueries(def, language, [layer])),
      );
    }

    let set: FixtureSet | undefined;
    let problem: Error | undefined;
    try {
      set = loadFixtureSet(def);
    } catch (err) {
      problem = err as Error;
    }

    it(
      `[${lang}] has a fixture directory with a valid expected.json`,
      report.check(lang, 'fixtures', () => {
        if (problem) throw problem;
      }),
    );
    // Without fixtures nothing below can run; the check above has failed and says what to add.
    if (!set) return;
    const fixtures = set;

    /** Symbols and call relations per fixture file, extracted once. */
    const extracted = new Map<string, Promise<{ symbols: ExtractedSymbol[]; calls: Set<string> }>>();
    const extract = (file: string): Promise<{ symbols: ExtractedSymbol[]; calls: Set<string> }> => {
      let pending = extracted.get(file);
      if (!pending) {
        pending = (async () => {
          const path = join(fixtures.dir, file);
          const { symbols } = await parseFile(path, def.profile).catch((err: Error) => {
            throw new Error(`[${lang}] ${file}: extraction failed: ${err.message}`);
          });
          const names = new Map(symbols.map((s) => [s.id, s.name]));
          const relations = extractRelations(symbols, readFileSync(path, 'utf-8'), path, def.profile);
          const calls = new Set(
            relations.filter((r) => r.kind === 'calls').map((r) => callSubject({ from: names.get(r.from_id) ?? '?', to: r.to_name ?? '?' })),
          );
          return { symbols, calls };
        })();
        extracted.set(file, pending);
      }
      return pending;
    };

    for (const file of fixtures.files) {
      const entry = fixtures.expected.files[file];
      const maxErrors = entry.maxErrorNodes ?? DEFAULT_MAX_ERROR_NODES;

      // --- parse -----------------------------------------------------------
      const parses = (): void => {
        const parser = new Parser();
        parser.setLanguage(language);
        const tree = parser.parse(readFileSync(join(fixtures.dir, file), 'utf-8'));
        try {
          if (!tree) throw new Error(`[${lang}] ${file}: the parser returned no tree`);
          const { count, samples } = countErrorNodes(tree.rootNode);
          if (count > maxErrors) {
            throw new Error(
              `[${lang}] ${file}: ${count} ERROR/MISSING nodes with grammar ${def.grammar}, at most ${maxErrors} allowed (${samples.join('; ')})`,
            );
          }
        } finally {
          tree?.delete();
          parser.delete();
        }
      };
      const parseGap = gapFor(fixtures, file, 'parse');
      if (parseGap) {
        it(`[${lang}] ${file}: known gap, does not parse cleanly (${parseGap.fixedBy})`, report.knownGap(lang, 'parse', parseGap, parses));
      } else {
        it(`[${lang}] ${file} parses with at most ${maxErrors} ERROR/MISSING nodes`, report.check(lang, 'parse', parses));
      }

      // --- symbols ---------------------------------------------------------
      const required = entry.symbols.filter((s) => !gapFor(fixtures, file, 'symbols', symbolSubject(s)));
      it(
        `[${lang}] ${file}: the ${required.length} expected definitions are extracted (name, kind, line, isExported)`,
        report.check(lang, 'symbols', async () => {
          const { symbols } = await extract(file);
          assertAll(required, (expected) => assertSymbolExtracted(lang, file, expected, symbols));
        }),
      );
      it(
        `[${lang}] ${file}: extracts between ${entry.symbolCount.min} and ${entry.symbolCount.max} symbols`,
        report.check(lang, 'symbols', async () => {
          const { symbols } = await extract(file);
          const { min, max } = entry.symbolCount;
          if (symbols.length < min || symbols.length > max) {
            throw new Error(
              `[${lang}] ${file}: extracted ${symbols.length} symbols, expected ${min}-${max}: ` +
                symbols.map((s) => `${s.kind} ${s.name}@${s.start_line}`).join(', '),
            );
          }
        }),
      );
      for (const expected of entry.symbols) {
        const gap = gapFor(fixtures, file, 'symbols', symbolSubject(expected));
        if (!gap) continue;
        it(
          `[${lang}] ${file}: known gap, ${expected.kind} ${symbolSubject(expected)} (${gap.fixedBy})`,
          report.knownGap(lang, 'symbols', gap, async () => {
            assertSymbolExtracted(lang, file, expected, (await extract(file)).symbols);
          }),
        );
      }

      // --- signatures and doc comments ---------------------------------------
      // A symbol that is a known `symbols` gap may not exist at all, so its text is not checked.
      const documented = required.filter((s) => !gapFor(fixtures, file, 'docs', symbolSubject(s)));
      it(
        `[${lang}] ${file}: signatures are non-empty and ${documented.filter((s) => s.doc).length} doc comments are found`,
        report.check(lang, 'docs', async () => {
          const { symbols } = await extract(file);
          assertAll(documented, (expected) => assertSymbolDocumented(lang, file, expected, symbols));
        }),
      );
      for (const expected of required) {
        const gap = gapFor(fixtures, file, 'docs', symbolSubject(expected));
        if (!gap) continue;
        it(
          `[${lang}] ${file}: known gap, signature/doc of ${symbolSubject(expected)} (${gap.fixedBy})`,
          report.knownGap(lang, 'docs', gap, async () => {
            assertSymbolDocumented(lang, file, expected, (await extract(file)).symbols);
          }),
        );
      }

      // --- calls (tiers with a call graph) -----------------------------------
      if (!TIERS_WITH_CALLS.has(def.tier)) continue;
      const hasCall = async (subject: string): Promise<void> => {
        const { calls } = await extract(file);
        if (!calls.has(subject)) {
          throw new Error(
            `[${lang}] ${file}: expected call ${subject} was not extracted by the relation pipeline ` +
              `(found: ${[...calls].join(', ') || 'no calls'})`,
          );
        }
      };
      const expectedCalls = (entry.calls ?? []).map(callSubject);
      const requiredCalls = expectedCalls.filter((subject) => !gapFor(fixtures, file, 'calls', subject));
      if (requiredCalls.length > 0) {
        it(
          `[${lang}] ${file}: the expected calls are extracted (${requiredCalls.join(', ')})`,
          report.check(lang, 'calls', async () => {
            const { calls } = await extract(file);
            const missing = requiredCalls.filter((subject) => !calls.has(subject));
            if (missing.length > 0) {
              throw new Error(
                `[${lang}] ${file}: expected calls not extracted by the relation pipeline: ${missing.join(', ')} ` +
                  `(found: ${[...calls].join(', ') || 'no calls'})`,
              );
            }
          }),
        );
      }
      for (const subject of expectedCalls) {
        const gap = gapFor(fixtures, file, 'calls', subject);
        if (!gap) continue;
        it(`[${lang}] ${file}: known gap, call ${subject} (${gap.fixedBy})`, report.knownGap(lang, 'calls', gap, () => hasCall(subject)));
      }
    }
  });
}
