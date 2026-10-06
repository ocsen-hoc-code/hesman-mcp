import { describe, it, expect } from 'vitest';
import { importedFiles, pickCallTarget } from '../../../src/indexing/call-resolver';

const c = (id: string, file_path: string) => ({ id, file_path });

describe('pickCallTarget', () => {
  it('prefers a definition in the caller file', () => {
    const target = pickCallTarget('/p/a.ts', [c('other', '/p/b.ts'), c('local', '/p/a.ts')], new Set());
    expect(target).toBe('local');
  });

  it('then a definition in a file the caller imports', () => {
    const target = pickCallTarget(
      '/p/src/a.ts',
      [c('far', '/p/lib/x.ts'), c('imported', '/p/src/b.ts')],
      new Set(['/p/src/b.ts']),
    );
    expect(target).toBe('imported');
  });

  it('then a definition in the same directory (Go package, Python sibling module)', () => {
    const target = pickCallTarget('/p/go/main.go', [c('far', '/p/other/x.go'), c('pkg', '/p/go/greet.go')], new Set());
    expect(target).toBe('pkg');
  });

  it('then the unique project-wide definition', () => {
    expect(pickCallTarget('/p/a.ts', [c('only', '/p/lib/x.ts')], new Set())).toBe('only');
  });

  it('returns null when the closest tier is ambiguous (no fan-out)', () => {
    expect(pickCallTarget('/p/a.ts', [c('x1', '/p/lib/x.ts'), c('x2', '/p/other/y.ts')], new Set())).toBeNull();
    expect(pickCallTarget('/p/go/main.go', [c('g1', '/p/go/a.go'), c('g2', '/p/go/b.go')], new Set())).toBeNull();
  });

  it('does not fall back to a farther tier once a closer tier is ambiguous', () => {
    const target = pickCallTarget(
      '/p/a.ts',
      [c('l1', '/p/a.ts'), c('l2', '/p/a.ts'), c('far', '/p/lib/x.ts')],
      new Set(),
    );
    expect(target).toBeNull();
  });

  it('returns null without candidates', () => {
    expect(pickCallTarget('/p/a.ts', [], new Set())).toBeNull();
  });
});

describe('importedFiles', () => {
  it('maps relative specifiers to candidate source files', () => {
    const files = importedFiles('/p/src/main.ts', ['./greet.js', '../lib/util', 'node:fs', 'react']);
    expect(files.has('/p/src/greet.ts')).toBe(true);
    expect(files.has('/p/src/greet.js')).toBe(true);
    expect(files.has('/p/lib/util.ts')).toBe(true);
    expect(files.has('/p/lib/util/index.ts')).toBe(true);
    expect([...files].some((f) => f.includes('react') || f.includes('node:fs'))).toBe(false);
  });
});
