import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanProject, detectLanguage } from '../../../src/indexing/project-scanner';
import { defaultConfig } from '../../../src/config/defaults';
import { resolve, dirname, join } from 'node:path';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'ts-basic');

describe('detectLanguage', () => {
  it('detects TypeScript by extension', () => {
    expect(detectLanguage('src/index.ts', defaultConfig)).toBe('typescript');
    expect(detectLanguage('src/component.tsx', defaultConfig)).toBe('tsx');
    expect(detectLanguage('src/util.js', defaultConfig)).toBe('javascript');
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

// Creating symlinks on Windows needs Developer Mode or admin rights, so these
// tests only run on POSIX platforms.
const SYMLINKS_UNSUPPORTED = process.platform === 'win32';

describe('scanProject symlink safety', () => {
  let projectDir: string;
  let outsideDir: string;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-scan-symlink-')));
    outsideDir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-scan-outside-')));
    mkdirSync(join(projectDir, 'src'));
    writeFileSync(join(projectDir, 'src', 'a.ts'), 'export function a() { return 1; }\n');
    writeFileSync(join(outsideDir, 'secret.ts'), 'export const secret = 42;\n');
    if (SYMLINKS_UNSUPPORTED) return;
    symlinkSync('.', join(projectDir, 'loop'), 'dir');
    symlinkSync(outsideDir, join(projectDir, 'outside'), 'dir');
    symlinkSync(join('src', 'a.ts'), join(projectDir, 'link.ts'), 'file');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it.skipIf(SYMLINKS_UNSUPPORTED)(
    'terminates, skips symlinked dirs and files, and indexes each real file once',
    () => {
      const files = scanProject(projectDir, defaultConfig);
      const paths = files.map((f) => f.filePath);

      expect(paths).toEqual([join(projectDir, 'src', 'a.ts')]);
      expect(paths.some((p) => p.includes('outside') || p.includes('secret.ts'))).toBe(false);
      expect(paths.some((p) => p.endsWith('link.ts'))).toBe(false);
    },
    10_000,
  );
});
