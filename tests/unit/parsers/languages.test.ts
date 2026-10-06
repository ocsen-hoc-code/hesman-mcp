import { describe, it, expect } from 'vitest';
import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import {
  LANGUAGES,
  LANGUAGE_IDS,
  isLanguageId,
  languageById,
  languageForExtension,
  languageForPath,
  profileFor,
} from '../../../src/parsers/languages';

describe('language registry', () => {
  it('registers TypeScript, Python and Go', () => {
    expect(LANGUAGE_IDS).toEqual(['typescript', 'python', 'go']);
    expect(isLanguageId('python')).toBe(true);
    expect(isLanguageId('cobol')).toBe(false);
  });

  it('maps paths to language ids by extension', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript');
    expect(languageForPath('src/a.d.ts')).toBe('typescript');
    expect(languageForPath('src/a.mjs')).toBe('typescript');
    expect(languageForPath('/abs/pkg/mod.py')).toBe('python');
    expect(languageForPath('stubs/mod.pyi')).toBe('python');
    expect(languageForPath('main.go')).toBe('go');
    expect(languageForPath('Main.GO')).toBe('go');
    expect(languageForPath('README.md')).toBeUndefined();
    expect(languageForPath('Dockerfile')).toBeUndefined();
    expect(languageForPath('.gitignore')).toBeUndefined();
  });

  it('looks up entries by extension with or without the dot', () => {
    expect(languageForExtension('.py')?.id).toBe('python');
    expect(languageForExtension('go')?.id).toBe('go');
    expect(languageForExtension('.rs')).toBeUndefined();
  });

  it('returns the profile for a language id', () => {
    expect(profileFor('go')?.language).toBe('go');
    expect(profileFor('unknown')).toBeUndefined();
    expect(languageById('python')?.grammar).toBe('tree-sitter-python.wasm');
  });

  it.each(LANGUAGES.map((l) => [l.id, l] as const))('%s entry agrees with its profile and grammar file', (_id, def) => {
    expect(def.profile.language).toBe(def.id);
    expect([...def.profile.extensions].sort()).toEqual([...def.extensions].sort());
    expect(basename(def.profile.parserWasmPath)).toBe(def.grammar);
    expect(existsSync(def.profile.parserWasmPath)).toBe(true);
    for (const ext of def.extensions) {
      expect(ext).toMatch(/^\.[a-z0-9]+$/);
    }
  });
});
