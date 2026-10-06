import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ProjectPathError,
  normalizeProjectPath,
  resolveProjectPath,
} from '../../../src/server/paths.js';

const MAX = 1024;
const isWindows = process.platform === 'win32';

function expectPathError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ProjectPathError);
  expect((caught as ProjectPathError).code).toBe(code);
}

describe('resolveProjectPath', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    // Deliberately keep the un-realpathed tmpdir() form (on macOS `/var/...`,
    // which realpaths to `/private/var/...`) to match what the scanner stores.
    root = mkdtempSync(join(tmpdir(), 'hesman-paths-root-'));
    outside = mkdtempSync(join(tmpdir(), 'hesman-paths-outside-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'big.ts'), 'x'.repeat(MAX + 1));
    writeFileSync(join(outside, 'secret.txt'), 'top secret\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects a relative path that escapes the root (../../etc/passwd)', () => {
    expectPathError(
      () => resolveProjectPath(root, '../../etc/passwd', { maxFileSizeBytes: MAX }),
      'PATH_OUTSIDE_PROJECT',
    );
  });

  it.skipIf(isWindows)('rejects an absolute path outside the root (/etc/hosts)', () => {
    expectPathError(
      () => resolveProjectPath(root, '/etc/hosts', { maxFileSizeBytes: MAX }),
      'PATH_OUTSIDE_PROJECT',
    );
  });

  it.runIf(isWindows)('rejects an absolute path outside the root (C:\\Windows\\win.ini)', () => {
    expectPathError(
      () => resolveProjectPath(root, 'C:\\Windows\\win.ini', { maxFileSizeBytes: MAX }),
      'PATH_OUTSIDE_PROJECT',
    );
  });

  it.skipIf(isWindows)('rejects an in-root symlink that points outside the root', () => {
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    expectPathError(
      () => resolveProjectPath(root, 'link.txt', { maxFileSizeBytes: MAX }),
      'PATH_OUTSIDE_PROJECT',
    );
  });

  it.skipIf(isWindows)('rejects a symlinked directory that points outside the root', () => {
    symlinkSync(outside, join(root, 'linkdir'));
    expectPathError(
      () => resolveProjectPath(root, 'linkdir/secret.txt', { maxFileSizeBytes: MAX }),
      'PATH_OUTSIDE_PROJECT',
    );
  });

  it.skipIf(isWindows)('rejects /dev/zero', () => {
    expectPathError(
      () => resolveProjectPath(root, '/dev/zero', { maxFileSizeBytes: MAX }),
      'PATH_OUTSIDE_PROJECT',
    );
  });

  it('rejects a directory inside the root', () => {
    expectPathError(() => resolveProjectPath(root, 'src', { maxFileSizeBytes: MAX }), 'INVALID_INPUT');
  });

  it('rejects the project root itself', () => {
    expectPathError(() => resolveProjectPath(root, '.', { maxFileSizeBytes: MAX }), 'INVALID_INPUT');
  });

  it('rejects a file larger than maxFileSizeBytes', () => {
    expectPathError(() => resolveProjectPath(root, 'big.ts', { maxFileSizeBytes: MAX }), 'INVALID_INPUT');
  });

  it('reports a missing file inside the root as FILE_NOT_FOUND', () => {
    expectPathError(
      () => resolveProjectPath(root, 'src/missing.ts', { maxFileSizeBytes: MAX }),
      'FILE_NOT_FOUND',
    );
  });

  it('reports a missing file outside the root as PATH_OUTSIDE_PROJECT (no existence oracle)', () => {
    expectPathError(
      () => resolveProjectPath(root, join(outside, 'nope.txt'), { maxFileSizeBytes: MAX }),
      'PATH_OUTSIDE_PROJECT',
    );
  });

  it('rejects empty and non-string input', () => {
    expectPathError(() => resolveProjectPath(root, '', { maxFileSizeBytes: MAX }), 'INVALID_INPUT');
    expectPathError(() => resolveProjectPath(root, 42 as unknown as string, { maxFileSizeBytes: MAX }), 'INVALID_INPUT');
    expectPathError(() => resolveProjectPath(root, 'src/a.ts\0', { maxFileSizeBytes: MAX }), 'INVALID_INPUT');
  });

  it('accepts a valid relative path and returns the absolute path under the root', () => {
    expect(resolveProjectPath(root, 'src/a.ts', { maxFileSizeBytes: MAX })).toBe(join(root, 'src', 'a.ts'));
  });

  it('accepts a valid absolute path', () => {
    const abs = join(root, 'src', 'a.ts');
    expect(resolveProjectPath(root, abs, { maxFileSizeBytes: MAX })).toBe(abs);
  });

  it('accepts a file name that merely starts with ".."', () => {
    writeFileSync(join(root, '..notes.ts'), 'x');
    expect(resolveProjectPath(root, '..notes.ts', { maxFileSizeBytes: MAX })).toBe(join(root, '..notes.ts'));
  });

  it('maps a realpath-form absolute path back to the root form used as DB key', () => {
    const real = join(realpathSync(root), 'src', 'a.ts');
    expect(resolveProjectPath(root, real, { maxFileSizeBytes: MAX })).toBe(join(root, 'src', 'a.ts'));
  });

  it.skipIf(isWindows)('accepts an in-root symlink to another in-root file', () => {
    symlinkSync(join(root, 'src', 'a.ts'), join(root, 'alias.ts'));
    expect(resolveProjectPath(root, 'alias.ts', { maxFileSizeBytes: MAX })).toBe(join(root, 'alias.ts'));
  });
});

describe('normalizeProjectPath', () => {
  it('resolves a relative path against the project root', () => {
    expect(normalizeProjectPath('/proj', 'src/a.ts')).toBe(resolve('/proj', 'src', 'a.ts'));
  });

  it('keeps an absolute path absolute and normalized', () => {
    expect(normalizeProjectPath('/proj', '/proj/src/../src/a.ts')).toBe(resolve('/proj', 'src', 'a.ts'));
  });

  it('does not touch the disk (missing files are fine)', () => {
    expect(normalizeProjectPath('/does-not-exist', 'x.ts')).toBe(resolve('/does-not-exist', 'x.ts'));
  });
});
