import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileImports, importedFiles, pickCallTarget, resolveCall } from '../../../src/indexing/call-resolver';
import type { CallTargetCandidate } from '../../../src/stores/sqlite';

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
  const local = (id: string, file_path: string) => ({ id, file_path, reach: 'file' as const });

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

describe('pickCallTarget: visibility (M1-09)', () => {
  const none = new Set<string>();

  it('`include` reach: linked from a file that imports the candidate, not through the directory or project tier', () => {
    const helper = [{ id: 'static', file_path: '/p/include/clamp.h', reach: 'include' as const }];
    expect(pickCallTarget('/p/src/item.c', helper, new Set(['/p/include/clamp.h']))).toBe('static');
    expect(pickCallTarget('/p/src/item.c', helper, none)).toBeNull();
    expect(pickCallTarget('/p/include/other.c', helper, none)).toBeNull();
  });

  it('`directory` reach: linked from the same directory, also when another file imports it from elsewhere', () => {
    const helper = [{ id: 'lower', file_path: '/p/stock/clamp.go', reach: 'directory' as const }];
    expect(pickCallTarget('/p/stock/item.go', helper, none)).toBe('lower');
    expect(pickCallTarget('/p/report/report.go', helper, none)).toBeNull();
    expect(pickCallTarget('/p/report/report.go', helper, new Set(['/p/stock/clamp.go']))).toBeNull();
  });

  it('a candidate out of reach does not make a reachable one ambiguous', () => {
    const candidates = [
      { id: 'private', file_path: '/p/lib/x.ts', reach: 'file' as const },
      { id: 'exported', file_path: '/p/lib/y.ts' },
    ];
    expect(pickCallTarget('/p/a.ts', candidates, none)).toBe('exported');
  });
});

describe('pickCallTarget: member calls (M1-09)', () => {
  const none = new Set<string>();
  const free: CallTargetCandidate = { id: 'free', file_path: '/p/lib/util.ts' };
  const method: CallTargetCandidate = { id: 'method', file_path: '/p/lib/store.ts', member: true, parent_id: 'Store', container: 'Store' };

  it('a call with a receiver is not linked to a free function or a variable, in any tier', () => {
    expect(pickCallTarget('/p/a.ts', [free], none, { receiver: 'items' })).toBeNull();
    expect(pickCallTarget('/p/lib/other.ts', [free], none, { receiver: 'items' })).toBeNull();
    expect(pickCallTarget('/p/lib/util.ts', [free], none, { receiver: 'items' })).toBeNull();
    expect(pickCallTarget('/p/a.ts', [free], new Set(['/p/lib/util.ts']), { receiver: '*' })).toBeNull();
  });

  it('the same call without a receiver is linked', () => {
    expect(pickCallTarget('/p/a.ts', [free], none)).toBe('free');
    expect(pickCallTarget('/p/a.ts', [free], none, { receiver: null })).toBe('free');
  });

  it('a call with a receiver is linked to a method, a property function or a class', () => {
    expect(pickCallTarget('/p/a.ts', [method], none, { receiver: 'store' })).toBe('method');
    expect(pickCallTarget('/p/a.ts', [free, method], none, { receiver: 'store' })).toBe('method');
    expect(pickCallTarget('/p/a.ts', [{ id: 'class', file_path: '/p/lib/models.py', type: true }], none, { receiver: 'models' })).toBe('class');
  });

  it('a member that is not exported is reached through its object where its file is imported or in the same directory', () => {
    const hidden: CallTargetCandidate = { id: 'hidden', file_path: '/p/lib/adapter.ts', member: true, reach: 'file' };
    expect(pickCallTarget('/p/src/setup.ts', [hidden], new Set(['/p/lib/adapter.ts']), { receiver: 'client' })).toBe('hidden');
    expect(pickCallTarget('/p/lib/setup.ts', [hidden], none, { receiver: 'client' })).toBe('hidden');
    // The name alone is no evidence: not through the project-wide tier, and never by a bare call.
    expect(pickCallTarget('/p/src/setup.ts', [hidden], none, { receiver: 'client' })).toBeNull();
    expect(pickCallTarget('/p/src/setup.ts', [hidden], new Set(['/p/lib/adapter.ts']))).toBeNull();
    expect(pickCallTarget('/p/lib/setup.ts', [hidden], none)).toBeNull();
    // A free function that is out of reach stays out of reach for `util.f()`.
    const lower = [{ id: 'lower', file_path: '/p/util/clamp.go', reach: 'directory' as const }];
    expect(pickCallTarget('/p/cmd/main.go', lower, none, { receiver: 'util' })).toBeNull();
    expect(pickCallTarget('/p/util/item.go', lower, none, { receiver: 'util' })).toBe('lower');
  });

  it('a receiver that names the module, class or namespace of a free function reaches it', () => {
    expect(pickCallTarget('/p/src/main.rs', [{ id: 'f', file_path: '/p/src/util.rs' }], none, { receiver: 'util' })).toBe('f');
    expect(pickCallTarget('/p/src/main.rs', [{ id: 'f', file_path: '/p/src/util/mod.rs' }], none, { receiver: 'util' })).toBe('f');
    expect(pickCallTarget('/p/main.cpp', [{ id: 'f', file_path: '/p/math.cpp', container: 'util' }], none, { receiver: 'util' })).toBe('f');
    expect(pickCallTarget('/p/src/main.rs', [{ id: 'f', file_path: '/p/src/util.rs' }], none, { receiver: 'items' })).toBeNull();
  });

  it('`this.x()` is the member of the caller\'s own class, even when other classes have one', () => {
    const other: CallTargetCandidate = { id: 'other', file_path: '/p/lib/cache.ts', member: true, parent_id: 'Cache' };
    expect(pickCallTarget('/p/lib/store.ts', [method, other], none, { receiver: 'this', callerParent: 'Store' })).toBe('method');
    expect(pickCallTarget('/p/lib/store.ts', [method, other], none, { receiver: 'self', callerParent: 'Cache' })).toBe('other');
    // Not a member of the own class (inherited): an ordinary member call.
    expect(pickCallTarget('/p/lib/sub.ts', [method], none, { receiver: 'this', callerParent: 'Sub' })).toBe('method');
    expect(pickCallTarget('/p/lib/sub.ts', [method, other], none, { receiver: 'this', callerParent: 'Sub' })).toBeNull();
  });

  it('`super.x()` is never the member of the caller\'s own class', () => {
    const own: CallTargetCandidate = { id: 'own', file_path: '/p/lib/sub.py', member: true, parent_id: 'Sub' };
    const base: CallTargetCandidate = { id: 'base', file_path: '/p/lib/base.py', member: true, parent_id: 'Base' };
    expect(pickCallTarget('/p/lib/sub.py', [own, base], none, { receiver: 'super', callerParent: 'Sub' })).toBe('base');
    expect(pickCallTarget('/p/lib/sub.py', [own], none, { receiver: 'super', callerParent: 'Sub' })).toBeNull();
  });
});

describe('resolveCall: imports win (M1-09)', () => {
  const imports = (file: string, list: Array<[specifier: string, names: string | null]>): FileImports =>
    new FileImports(file, list.map(([specifier, names]) => ({ specifier, names })));
  const exported = (id: string, file_path: string): CallTargetCandidate => ({ id, file_path });

  it('a name imported from a package or a built-in is external, whatever the project defines', () => {
    const fromNode = imports('/p/src/paths.ts', [['node:path', 'join']]);
    expect(resolveCall('join', [exported('project', '/p/src/lib/join.ts')], fromNode)).toBeNull();
    expect(resolveCall('join', [exported('sibling', '/p/src/join.ts')], fromNode)).toBeNull();
    // Without the import the unique project-wide definition is the target.
    expect(resolveCall('join', [exported('project', '/p/src/lib/join.ts')], imports('/p/src/paths.ts', []))).toBe('project');
  });

  it('a name imported from a project file is linked to that file only', () => {
    const fromFmt = imports('/p/src/a.ts', [['./fmt.js', 'format']]);
    const candidates = [exported('fmt', '/p/src/fmt.ts'), exported('other', '/p/src/other.ts')];
    expect(resolveCall('format', candidates, fromFmt)).toBe('fmt');
    expect(resolveCall('format', [exported('other', '/p/src/other.ts')], fromFmt)).toBeNull();
  });

  it('a definition in the calling file wins over an import of the same name', () => {
    const fromNode = imports('/p/src/a.ts', [['node:path', 'join']]);
    expect(resolveCall('join', [exported('own', '/p/src/a.ts')], fromNode)).toBe('own');
  });

  it('a name is followed through a file that re-exports it', () => {
    const fromIndex = imports('/p/src/a.ts', [['./lib/index.js', 'format']]);
    const lookup = (file: string): FileImports =>
      imports(file, file === '/p/src/lib/index.ts' ? [['./fmt.js', null]] : []);
    expect(resolveCall('format', [exported('fmt', '/p/src/lib/fmt.ts')], fromIndex, {}, lookup)).toBe('fmt');
    expect(resolveCall('format', [exported('elsewhere', '/p/src/other/fmt.ts')], fromIndex, {}, lookup)).toBeNull();
  });

  it('`ns.f()` on a namespace import is a function of that module, or external', () => {
    const local = imports('/p/src/a.ts', [['./fmt.js', '*fmt']]);
    expect(resolveCall('format', [exported('fmt', '/p/src/fmt.ts')], local, { receiver: 'fmt' })).toBe('fmt');
    const external = imports('/p/src/a.ts', [['node:util', '*util']]);
    const method: CallTargetCandidate = { id: 'method', file_path: '/p/src/printer.ts', member: true };
    expect(resolveCall('format', [method], external, { receiver: 'util' })).toBeNull();
    // The same member call on a value that is not an imported module is linked to the method.
    expect(resolveCall('format', [method], external, { receiver: 'printer' })).toBe('method');
  });

  it('an imported value keeps ordinary member calls when its file does not define the member', () => {
    const fromStore = imports('/p/src/a.ts', [['./store.js', 'store']]);
    const inStore: CallTargetCandidate = { id: 'here', file_path: '/p/src/store.ts', member: true };
    const elsewhere: CallTargetCandidate = { id: 'base', file_path: '/p/src/base.ts', member: true };
    expect(resolveCall('get', [inStore, elsewhere], fromStore, { receiver: 'store' })).toBe('here');
    expect(resolveCall('get', [elsewhere], fromStore, { receiver: 'store' })).toBe('base');
  });

  it('Go: a package is used by its alias or by the last element of its path', () => {
    const go = imports('/p/cmd/main.go', [['strings', null], ['example.com/shop/util/v2', null], ['example.com/shop/model', '*m']]);
    expect(go.binding('strings')).toEqual({ specifier: 'strings', module: true });
    expect(go.binding('util')).toEqual({ specifier: 'example.com/shop/util/v2', module: true });
    expect(go.binding('m')).toEqual({ specifier: 'example.com/shop/model', module: true });
    expect(go.binding('model')).toBeUndefined();
    expect(resolveCall('Join', [exported('project', '/p/cmd/join.go')], go, { receiver: 'strings' })).toBeNull();
  });

  it('Python: `from . import util` binds a submodule', () => {
    const py = imports('/p/app/main.py', [['.', 'util']]);
    expect(resolveCall('join', [exported('util', '/p/app/util.py')], py, { receiver: 'util' })).toBe('util');
    expect(resolveCall('join', [exported('other', '/p/app/other.py')], py, { receiver: 'util' })).toBeNull();
  });
});

describe('importedFiles: specifiers that are not relative (M1-09)', () => {
  let dir: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-packages-')));
    mkdirSync(join(dir, 'packages', 'utils', 'src'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'utils', 'package.json'), '{ "name": "@acme/utils" }');
    writeFileSync(join(dir, 'package.json'), '{ "name": "root", "private": true }');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a package specifier maps to the files of the workspace package of that name', () => {
    const files = importedFiles(join(dir, 'packages', 'app', 'src', 'main.ts'), ['@acme/utils', '@acme/utils/deep', 'lodash']);
    expect(files.has(join(dir, 'packages', 'utils', 'src', 'clamp.ts'))).toBe(true);
    expect(files.has(join(dir, 'packages', 'other', 'src', 'clamp.ts'))).toBe(false);
    expect(importedFiles(join(dir, 'a.ts'), ['lodash']).has(join(dir, 'packages', 'utils', 'src', 'clamp.ts'))).toBe(false);
  });

  it('a path alias fixes the end of the file path; a built-in maps to nothing', () => {
    const files = importedFiles('/p/src/app/main.ts', ['@/lib/format', '~/lib/clamp.js', 'node:path', 'path']);
    expect(files.has('/p/src/lib/format.ts')).toBe(true);
    expect(files.has('/p/src/lib/format/index.tsx')).toBe(true);
    expect(files.has('/p/src/lib/clamp.ts')).toBe(true);
    expect(files.has('/p/src/other/format.ts')).toBe(false);
    expect(files.has('/p/src/path.ts')).toBe(false);
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
