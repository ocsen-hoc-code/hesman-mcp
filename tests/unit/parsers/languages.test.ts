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
import { textLanguageForPath } from '../../../src/parsers/text-languages';
import { INDEX_SCHEMA_VERSION } from '../../../src/stores/sqlite';

/** The bundled core set of ADR 0001 (section 10), in registry order. */
const CORE_SET = [
  'typescript',
  'tsx',
  'javascript',
  'python',
  'go',
  'java',
  'c',
  'cpp',
  'csharp',
  'rust',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'bash',
  'lua',
];

describe('language registry', () => {
  it('registers the 16 languages of the bundled core set', () => {
    expect(LANGUAGE_IDS).toEqual(CORE_SET);
    expect(isLanguageId('python')).toBe(true);
    expect(isLanguageId('kotlin')).toBe(true);
    expect(isLanguageId('cobol')).toBe(false);
  });

  it('gives TSX and JavaScript their own grammars instead of the TypeScript one', () => {
    expect(languageById('typescript')?.extensions).toEqual(['.ts', '.mts', '.cts']);
    expect(languageById('tsx')?.extensions).toEqual(['.tsx']);
    expect(languageById('javascript')?.extensions).toEqual(['.js', '.jsx', '.mjs', '.cjs']);
    expect(languageById('tsx')?.grammar).toBe('tree-sitter-tsx.wasm');
    expect(languageById('javascript')?.grammar).toBe('tree-sitter-javascript.wasm');
  });

  it('bumped the index schema version when .js/.jsx/.tsx files changed grammar and language id', () => {
    expect(INDEX_SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
  });

  it('runs the regex relation extractor exactly for the deep tier', () => {
    for (const def of LANGUAGES) {
      expect(def.profile.relationQueries !== undefined, `${def.id}: tier ${def.tier}`).toBe(def.tier === 'deep');
    }
  });

  it.each(LANGUAGES.flatMap((l) => l.extensions.map((ext) => [ext, l.id] as const)))(
    'the text-tier label of %s is the registry id %s',
    (ext, id) => {
      // A file whose grammar is unavailable falls back to the text tier and must keep its language.
      expect(textLanguageForPath(`src/file${ext}`)).toBe(id);
    },
  );

  it('maps paths to language ids by extension', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript');
    expect(languageForPath('src/a.d.ts')).toBe('typescript');
    expect(languageForPath('src/a.mts')).toBe('typescript');
    expect(languageForPath('src/a.tsx')).toBe('tsx');
    expect(languageForPath('src/a.js')).toBe('javascript');
    expect(languageForPath('src/a.jsx')).toBe('javascript');
    expect(languageForPath('src/a.mjs')).toBe('javascript');
    expect(languageForPath('src/a.cjs')).toBe('javascript');
    expect(languageForPath('src/Main.java')).toBe('java');
    expect(languageForPath('src/util.c')).toBe('c');
    expect(languageForPath('include/util.h')).toBe('c');
    expect(languageForPath('src/util.cpp')).toBe('cpp');
    expect(languageForPath('include/util.hpp')).toBe('cpp');
    expect(languageForPath('src/Program.cs')).toBe('csharp');
    expect(languageForPath('src/lib.rs')).toBe('rust');
    expect(languageForPath('public/index.php')).toBe('php');
    expect(languageForPath('app/models/user.rb')).toBe('ruby');
    expect(languageForPath('src/Main.kt')).toBe('kotlin');
    expect(languageForPath('build.gradle.kts')).toBe('kotlin');
    expect(languageForPath('Sources/App.swift')).toBe('swift');
    expect(languageForPath('scripts/deploy.sh')).toBe('bash');
    expect(languageForPath('init.lua')).toBe('lua');
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
    expect(languageForExtension('.rs')?.id).toBe('rust');
    expect(languageForExtension('.zig')).toBeUndefined();
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
