import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureGrammarStore, grammarStore, loadGrammarManifest } from '../../../src/parsers/grammar-store';
import {
  LANGUAGES,
  LANGUAGE_IDS,
  hasGrammar,
  isLanguageId,
  languageById,
  languageForExtension,
  languageForPath,
  profileFor,
  tagsQueryFiles,
} from '../../../src/parsers/languages';
import { ON_DEMAND_LANGUAGES, onDemandLanguageForPath } from '../../../src/parsers/on-demand-languages';
import { textLanguageForPath } from '../../../src/parsers/text-languages';
import { parseFile } from '../../../src/parsers/core';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GRAMMAR_FIXTURES = join(REPO, 'tests', 'fixtures', 'grammars');
const R_FILE = join(REPO, 'tests', 'fixtures', 'on-demand', 'r', 'stats.R');

describe('on-demand languages', () => {
  let cacheRoot: string;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'hesman-on-demand-'));
    configureGrammarStore({ cacheRoot, offline: true });
  });

  afterEach(() => {
    configureGrammarStore({ cacheRoot: undefined, offline: undefined });
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('are the manifest entries that are not bundled and have a tags query', () => {
    const manifest = loadGrammarManifest();
    const expected = Object.entries(manifest.grammars)
      .filter(([, entry]) => !entry.bundled && entry.queries)
      .map(([id]) => id);
    expect(ON_DEMAND_LANGUAGES.map((l) => l.id)).toEqual(expected);
    expect(expected).toContain('r');
    expect(expected).toContain('scala');
  });

  it('stay out of the bundled registry that the conformance suite and doctor iterate over', () => {
    expect(LANGUAGES).toHaveLength(16);
    for (const def of ON_DEMAND_LANGUAGES) {
      expect(LANGUAGE_IDS).not.toContain(def.id);
      expect(isLanguageId(def.id), def.id).toBe(false);
    }
  });

  it('are structural: symbols from the tags query, no relation extraction', () => {
    for (const def of ON_DEMAND_LANGUAGES) {
      expect(def.tier, def.id).toBe('structural');
      expect(def.profile.relationQueries, def.id).toBeUndefined();
      expect(def.profile.language).toBe(def.id);
      expect(tagsQueryFiles(def).length, def.id).toBeGreaterThan(0);
      expect(languageById(def.id)).toBe(def);
      expect(profileFor(def.id)).toBe(def.profile);
    }
  });

  it('label every extension with the language id on the text tier, so a file keeps its language when the grammar arrives', () => {
    for (const def of ON_DEMAND_LANGUAGES) {
      for (const ext of def.extensions) {
        expect(textLanguageForPath(`src/file${ext}`), `${def.id} ${ext}`).toBe(def.id);
        expect(onDemandLanguageForPath(`src/file${ext.toUpperCase()}`), ext).toBe(def.id);
      }
    }
    expect(onDemandLanguageForPath('src/app.ts')).toBeUndefined();
    expect(onDemandLanguageForPath('notes.txt')).toBeUndefined();
  });

  it('do not claim a file while the grammar is missing: it is a text-tier file', () => {
    expect(hasGrammar('r')).toBe(false);
    expect(languageForPath(R_FILE)).toBeUndefined();
    expect(languageForExtension('.r')).toBeUndefined();
    expect(textLanguageForPath(R_FILE)).toBe('r');
  });

  it('claim the file as soon as the grammar is in the cache', () => {
    expect(grammarStore().installFromDirectory(GRAMMAR_FIXTURES, ['r'])).toEqual([{ id: 'r', result: 'installed' }]);
    expect(hasGrammar('r')).toBe(true);
    expect(languageForPath(R_FILE)).toBe('r');
    expect(languageForExtension('R')?.id).toBe('r');
    // The other on-demand languages are still missing.
    expect(languageForPath('Main.scala')).toBeUndefined();
  });

  it('reports bundled languages as having a grammar and unknown ones as not', () => {
    expect(hasGrammar('python')).toBe(true);
    expect(hasGrammar('cobol')).toBe(false);
    expect(hasGrammar('markdown')).toBe(false);
  });

  it('parses a file with the cached grammar and the vendored upstream tags query', async () => {
    grammarStore().installFromDirectory(GRAMMAR_FIXTURES, ['r']);
    const result = await parseFile(R_FILE, profileFor('r')!);

    expect(result.language).toBe('r');
    expect(result.parseQuality).toBe('full');
    expect(result.symbols.map((s) => [s.name, s.kind, s.start_line])).toEqual([
      ['safe_mean', 'function', 4],
      ['spread', 'function', 9],
      ['report', 'function', 14],
    ]);
    expect(result.symbols[0]).toMatchObject({ language: 'r', is_exported: 1, doc_comment: expect.stringContaining('Arithmetic mean') });
  });

  it('refuses to load a grammar that is not in the cache', async () => {
    await expect(parseFile(join(REPO, 'tests', 'fixtures', 'on-demand', 'r', 'stats.R'), profileFor('scala')!)).rejects.toThrow(
      /scala grammar is not available/,
    );
  });
});
