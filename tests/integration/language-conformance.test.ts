/**
 * Language conformance, end to end (M1-03): the fixtures of every registered
 * language go through the real indexing path — project scan, `WorkerPool`
 * (compiled `dist/indexing/worker.js`), SQLite, call resolution — and every
 * language must come out with its files, its expected symbols and, for the
 * deep tier, its expected calls in the store.
 *
 * The in-process suite (`tests/conformance/`) cannot catch the v1.0 failure:
 * the parser knew Python and Go, the worker thread did not, and both indexed
 * 0 files. This test fails for exactly that, naming the language.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexProject, type IndexResult } from '../../src/indexing/index-coordinator';
import { WorkerPool } from '../../src/indexing/worker-pool';
import { SqliteStore } from '../../src/stores/sqlite';
import { defaultConfig } from '../../src/config/defaults';
import { LANGUAGES } from '../../src/parsers/languages';
import {
  ConformanceReport,
  FIXTURES_ROOT,
  TIERS_WITH_CALLS,
  assertAll,
  assertSymbolExtracted,
  callSubject,
  gapFor,
  loadFixtureSet,
  symbolSubject,
  type FixtureSet,
} from '../conformance/helpers';

const COLUMNS = ['indexed', 'symbols', 'calls'] as const;
const report = new ConformanceReport('Language conformance (worker pool + SQLite)', COLUMNS);

describe('language conformance: real indexing path (worker pool + SQLite)', () => {
  let workDir: string;
  let projectDir: string;
  let store: SqliteStore;
  let pool: WorkerPool;
  let result: IndexResult;

  beforeAll(async () => {
    // realpath: the scanner reports canonical paths (macOS tmpdir is a symlink).
    workDir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-conformance-')));
    projectDir = join(workDir, 'project');
    cpSync(FIXTURES_ROOT, projectDir, { recursive: true });
    store = new SqliteStore(join(workDir, 'data'));
    store.open();
    pool = new WorkerPool(2);
    result = await indexProject(projectDir, store, { ...defaultConfig, watchMode: false }, undefined, pool);
  }, 60000);

  afterAll(async () => {
    report.publish(LANGUAGES, 'conformance-indexing');
    await pool?.terminate();
    store?.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('indexes the fixtures without errors', () => {
    expect(result.errors).toEqual([]);
  });

  for (const def of LANGUAGES) {
    const lang = def.id;
    let set: FixtureSet | undefined;
    try {
      set = loadFixtureSet(def);
    } catch {
      // Reported, with instructions, by tests/conformance/languages.conformance.test.ts.
    }

    it(
      `[${lang}] every fixture file is indexed by a worker and stored as ${lang}`,
      report.check(lang, 'indexed', () => {
        if (!set) throw new Error(`[${lang}] has no usable fixtures in tests/fixtures/languages/${lang}/ (see tests/conformance/)`);
        const stats = store.getLanguageStats().find((s) => s.language === lang);
        if (!stats || stats.symbols === 0) {
          throw new Error(
            `[${lang}] the worker pool indexed 0 symbols for ${set.files.length} fixture file(s): ` +
              `the language is registered but does not reach the store (errors: ${JSON.stringify(result.errors)})`,
          );
        }
        assertAll(set.files, (file) => {
          const rows = store.getSymbolsByFile(join(projectDir, lang, file));
          if (rows.length === 0) throw new Error(`[${lang}] ${file}: no symbols in the store after indexing`);
          const other = rows.find((row) => row.language !== lang);
          if (other) throw new Error(`[${lang}] ${file}: stored with language "${other.language}"`);
        });
        expect(stats.files, `[${lang}] number of indexed files`).toBe(set.files.length);
      }),
    );
    if (!set) continue;
    const fixtures = set;

    it(
      `[${lang}] the expected definitions are in the store`,
      report.check(lang, 'symbols', () => {
        for (const file of fixtures.files) {
          const rows = store.getSymbolsByFile(join(projectDir, lang, file));
          const required = fixtures.expected.files[file].symbols.filter(
            (s) => !gapFor(fixtures, file, 'symbols', symbolSubject(s)),
          );
          assertAll(required, (expected) => assertSymbolExtracted(lang, file, expected, rows));
        }
      }),
    );

    if (!TIERS_WITH_CALLS.has(def.tier)) continue;
    it(
      `[${lang}] the expected calls between fixture symbols are resolved in the store`,
      report.check(lang, 'calls', () => {
        let checked = 0;
        for (const file of fixtures.files) {
          const rows = store.getSymbolsByFile(join(projectDir, lang, file));
          const entry = fixtures.expected.files[file];
          // Only a call to a symbol defined in the same file resolves to a stored target.
          const calls = (entry.calls ?? []).filter(
            (call) => !gapFor(fixtures, file, 'calls', callSubject(call)) && entry.symbols.some((s) => s.name === call.to),
          );
          assertAll(calls, (call) => {
            checked++;
            const callers = rows.filter((row) => row.name === call.from);
            const callees = callers.flatMap((caller) => store.getCallees(caller.id).map((callee) => callee.name));
            if (!callees.includes(call.to)) {
              throw new Error(
                `[${lang}] ${file}: call ${callSubject(call)} is not in the store ` +
                  `(callees of ${call.from}: ${callees.join(', ') || 'none'})`,
              );
            }
          });
        }
        expect(checked, `[${lang}] tier "${def.tier}" needs at least one expected call between two fixture symbols`).toBeGreaterThan(0);
      }),
    );
  }
});
