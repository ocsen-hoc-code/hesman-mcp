import { describe, it, expect } from 'vitest';
import { scanProject, detectLanguage } from '../../../src/indexing/project-scanner';
import { defaultConfig } from '../../../src/config/defaults';
import { resolve } from 'node:path';

const FIXTURE_DIR = resolve(import.meta.dirname, '..', '..', 'fixtures', 'ts-basic');

describe('detectLanguage', () => {
  it('detects TypeScript by extension', () => {
    expect(detectLanguage('src/index.ts', defaultConfig)).toBe('typescript');
    expect(detectLanguage('src/component.tsx', defaultConfig)).toBe('typescript');
    expect(detectLanguage('src/util.js', defaultConfig)).toBe('typescript');
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('README.md', defaultConfig)).toBeNull();
    expect(detectLanguage('Dockerfile', defaultConfig)).toBeNull();
  });
});

describe('scanProject', () => {
  it('finds all TypeScript files in fixture', () => {
    const files = scanProject(FIXTURE_DIR, defaultConfig);
    const tsFiles = files.filter((f) => f.language === 'typescript');
    expect(tsFiles.length).toBeGreaterThanOrEqual(2);
    expect(tsFiles.map((f) => f.filePath)).toContain(resolve(FIXTURE_DIR, 'src/index.ts'));
    expect(tsFiles.map((f) => f.filePath)).toContain(resolve(FIXTURE_DIR, 'src/utils.ts'));
  });

  it('skips files in node_modules', () => {
    const files = scanProject(FIXTURE_DIR, defaultConfig);
    const nodeModulesFiles = files.filter((f) => f.filePath.includes('node_modules'));
    expect(nodeModulesFiles).toHaveLength(0);
  });

  it('respects max file size', () => {
    const config = { ...defaultConfig, maxFileSizeBytes: 1 }; // 1 byte — skip everything
    const files = scanProject(FIXTURE_DIR, config);
    expect(files).toHaveLength(0);
  });

  it('respects language filter', () => {
    const config = { ...defaultConfig, languages: ['python'] };
    const files = scanProject(FIXTURE_DIR, config);
    expect(files).toHaveLength(0);
  });
});
