import { describe, it, expect } from 'vitest';
import {
  TEXT_LANGUAGE_FALLBACK,
  TEXT_LANGUAGE_LABELS,
  isTextLanguageLabel,
  textLanguageForPath,
} from '../../../src/parsers/text-languages.js';

describe('textLanguageForPath', () => {
  it('labels common languages by extension', () => {
    expect(textLanguageForPath('build.zig')).toBe('zig');
    expect(textLanguageForPath('db/schema.sql')).toBe('sql');
    expect(textLanguageForPath('scripts/deploy.zsh')).toBe('shell');
    // Extensions of a bundled grammar carry its registry id, so a fallback to the text tier keeps the language.
    expect(textLanguageForPath('scripts/deploy.sh')).toBe('bash');
    expect(textLanguageForPath('src/App.tsx')).toBe('tsx');
    expect(textLanguageForPath('app/models/user.rb')).toBe('ruby');
    expect(textLanguageForPath('legacy/payroll.cobol')).toBe('cobol');
    expect(textLanguageForPath('src/main.rs')).toBe('rust');
    expect(textLanguageForPath('docs/guide.md')).toBe('markdown');
    expect(textLanguageForPath('config/app.yaml')).toBe('yaml');
  });

  it('is case-insensitive on the extension', () => {
    expect(textLanguageForPath('LEGACY/PAYROLL.CBL')).toBe('cobol');
    expect(textLanguageForPath('Query.SQL')).toBe('sql');
  });

  it('labels well-known file names without an extension', () => {
    expect(textLanguageForPath('Dockerfile')).toBe('dockerfile');
    expect(textLanguageForPath('services/api/Dockerfile')).toBe('dockerfile');
    expect(textLanguageForPath('Makefile')).toBe('makefile');
    expect(textLanguageForPath('GNUmakefile')).toBe('makefile');
    expect(textLanguageForPath('Gemfile')).toBe('ruby');
    expect(textLanguageForPath('CMakeLists.txt')).toBe('cmake');
    expect(textLanguageForPath('go.mod')).toBe('go-module');
  });

  it('labels Dockerfile variants by prefix', () => {
    expect(textLanguageForPath('Dockerfile.prod')).toBe('dockerfile');
    expect(textLanguageForPath('api.dockerfile')).toBe('dockerfile');
  });

  it('falls back to "text" for anything unknown', () => {
    expect(TEXT_LANGUAGE_FALLBACK).toBe('text');
    expect(textLanguageForPath('notes.xyzzy')).toBe('text');
    expect(textLanguageForPath('LICENSE')).toBe('text');
    expect(textLanguageForPath('README')).toBe('text');
  });
});

describe('text language labels', () => {
  it('is a broad table', () => {
    expect(TEXT_LANGUAGE_LABELS.length).toBeGreaterThan(100);
    expect(TEXT_LANGUAGE_LABELS).toContain('text');
  });

  it('only uses labels that are safe in a ZVec filter and as an identifier', () => {
    for (const label of TEXT_LANGUAGE_LABELS) {
      expect(label).toMatch(/^[a-z0-9][a-z0-9+_-]*$/);
    }
  });

  it('recognises its own labels and nothing else', () => {
    expect(isTextLanguageLabel('ruby')).toBe(true);
    expect(isTextLanguageLabel('text')).toBe(true);
    expect(isTextLanguageLabel("ruby' OR '1'='1")).toBe(false);
    expect(isTextLanguageLabel('')).toBe(false);
    expect(isTextLanguageLabel('toString')).toBe(false);
  });
});
