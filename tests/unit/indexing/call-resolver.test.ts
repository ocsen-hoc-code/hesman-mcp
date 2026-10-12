import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('pickCallTarget: property-assigned functions (M1-08)', () => {
  const local = (id: string, file_path: string) => ({ id, file_path, same_file_only: true });

  it('links a same-file-only candidate from its own file', () => {
    expect(pickCallTarget('/p/a.ts', [local('handler', '/p/a.ts')], new Set())).toBe('handler');
  });

  it('never picks a same-file-only candidate in the whole-project tier, even when the name is unique', () => {
    expect(pickCallTarget('/p/a.ts', [local('handler', '/p/lib/x.ts')], new Set())).toBeNull();
  });

  it('never picks a same-file-only candidate from an imported file or the same directory', () => {
    expect(pickCallTarget('/p/a.ts', [local('handler', '/p/b.ts')], new Set(['/p/b.ts']))).toBeNull();
    expect(pickCallTarget('/p/a.ts', [local('handler', '/p/b.ts')], new Set())).toBeNull();
  });

  it('does not let a same-file-only candidate elsewhere make a real target ambiguous', () => {
    const target = pickCallTarget('/p/a.ts', [local('handler', '/p/lib/x.ts'), c('real', '/p/lib/y.ts')], new Set());
    expect(target).toBe('real');
  });

  it('still counts a same-file-only candidate in the caller file as a same-file candidate', () => {
    const target = pickCallTarget('/p/a.ts', [local('handler', '/p/a.ts'), c('declared', '/p/a.ts')], new Set());
    expect(target).toBeNull();
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

describe('importedFiles: languages other than TypeScript/JavaScript (M1-07)', () => {
  let dir: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-imports-')));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Python: relative imports are resolved from the package of the importing module', () => {
    const files = importedFiles('/p/app/api/main.py', ['.greet', '..core.util', '.']);
    expect(files.has('/p/app/api/greet.py')).toBe(true);
    expect(files.has('/p/app/api/greet/__init__.py')).toBe(true);
    expect(files.has('/p/app/core/util.py')).toBe(true);
    expect(files.has('/p/app/api/__init__.py')).toBe(true);
    expect(files.has('/p/app/api/other.py')).toBe(false);
  });

  it('Python: an absolute import matches the module path under any source root', () => {
    const files = importedFiles('/p/app/api/main.py', ['pkg.util', 'os']);
    expect(files.has('/p/src/pkg/util.py')).toBe(true);
    expect(files.has('/p/src/pkg/util/__init__.py')).toBe(true);
    expect(files.has('/p/src/other/util.py')).toBe(false);
    expect(files.has('/p/src/pkgs/util.py')).toBe(false);
  });

  it('Go: an import of the module in go.mod maps to the files of that package directory', () => {
    mkdirSync(join(dir, 'gomod', 'cmd', 'app'), { recursive: true });
    writeFileSync(join(dir, 'gomod', 'go.mod'), 'module example.com/shop\n\ngo 1.22\n');
    const files = importedFiles(join(dir, 'gomod', 'cmd', 'app', 'main.go'), ['fmt', 'example.com/shop/internal/util', 'example.com/other/util']);
    expect(files.has(join(dir, 'gomod', 'internal', 'util', 'clamp.go'))).toBe(true);
    expect(files.has(join(dir, 'gomod', 'internal', 'util', 'deep', 'x.go'))).toBe(false);
    expect(files.has(join(dir, 'gomod', 'other', 'util', 'clamp.go'))).toBe(false);
    expect(files.has(join(dir, 'gomod', 'fmt', 'print.go'))).toBe(false);
  });

  it('Go: without a go.mod above the file no import is mapped', () => {
    mkdirSync(join(dir, 'nomod'), { recursive: true });
    const files = importedFiles(join(dir, 'nomod', 'main.go'), ['example.com/shop/util']);
    expect(files.has(join(dir, 'nomod', 'util', 'clamp.go'))).toBe(false);
  });

  it('C and C++: an included header also stands for the source file of the same name', () => {
    const files = importedFiles('/p/src/report.c', ['inventory.h', 'stock/item.hpp', '../vendor/zip.h']);
    expect(files.has('/p/src/inventory.h')).toBe(true);
    expect(files.has('/p/src/inventory.c')).toBe(true);
    expect(files.has('/p/include/inventory.h')).toBe(true);
    expect(files.has('/p/lib/inventory.c')).toBe(true);
    expect(files.has('/p/include/stock/item.hpp')).toBe(true);
    expect(files.has('/p/lib/stock/item.cpp')).toBe(true);
    expect(files.has('/p/lib/other/item.cpp')).toBe(false);
    expect(files.has('/p/src/my_inventory.c')).toBe(false);
    expect(files.has('/p/vendor/zip.h')).toBe(true);
    expect(files.has('/p/vendor/zip.c')).toBe(true);
  });

  it('Ruby: `require_relative` is resolved from the requiring file, `require` by its path under any load path', () => {
    const files = importedFiles('/p/lib/shop/main.rb', ['util', '../core/clamp', 'shop/item']);
    expect(files.has('/p/lib/shop/util.rb')).toBe(true);
    expect(files.has('/p/lib/core/clamp.rb')).toBe(true);
    expect(files.has('/p/lib/shop/item.rb')).toBe(true);
    expect(files.has('/p/lib/shop/other.rb')).toBe(false);
  });
});
