import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { languageById, languageForPath } from '../parsers/languages.js';
import type { CallTargetCandidate, SqliteStore, StoredImport } from '../stores/sqlite.js';
import { decodeImportedNames, unresolvedCallId } from '../parsers/relation-extractor.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('call-resolver');

/** Which `calls` relations to re-resolve; omit to re-resolve all of them. */
export interface CallResolutionScope {
  /** Files that were (re-)indexed or removed: their own calls are re-resolved. */
  files: string[];
  /** Names of symbols added to or removed from the index: calls to them are re-resolved. */
  names: string[];
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
/** ESM TypeScript imports name the emitted file (`./greet.js` → `greet.ts`). */
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const PYTHON_EXTENSIONS = ['.py', '.pyi'];
/** A header stands for the source file of the same name, whatever its C or C++ extension. */
const C_FAMILY_EXTENSIONS = [...(languageById('c')?.extensions ?? []), ...(languageById('cpp')?.extensions ?? [])];

/**
 * The project files the imports of one file may refer to. Some imports name a
 * file exactly; others (a Python absolute import, an `#include` found through
 * an include path, a Ruby `require`) only fix the end of its path, and a Go
 * import names a package directory.
 */
export class ImportedFiles implements Iterable<string> {
  private readonly files = new Set<string>();
  private readonly directories = new Set<string>();
  private readonly suffixes = new Set<string>();
  private readonly packages = new Set<string>();

  /** @param packageNames - `package.json` lookups to share between the files of one run */
  constructor(private readonly packageNames: PackageNameCache = new Map()) {}

  addFile(path: string): void {
    this.files.add(path);
  }

  /** Every file directly inside `path`. */
  addDirectory(path: string): void {
    this.directories.add(path);
  }

  /** Every file whose path ends with `/` + `relativePath`. */
  addPathEnding(relativePath: string): void {
    this.suffixes.add(`/${relativePath}`);
  }

  /** Every file of the package named `name` (the `name` of the nearest `package.json` above the file). */
  addPackage(name: string): void {
    this.packages.add(name);
  }

  has(file: string): boolean {
    if (this.files.has(file) || this.directories.has(dirname(file))) return true;
    for (const suffix of this.suffixes) {
      if (file.endsWith(suffix)) return true;
    }
    if (this.packages.size > 0) {
      const name = packageNameOf(dirname(file), this.packageNames);
      if (name !== null && this.packages.has(name)) return true;
    }
    return false;
  }

  /** The files named exactly. */
  [Symbol.iterator](): IterableIterator<string> {
    return this.files.values();
  }
}

/** `package.json` lookups of one resolution run, by directory (null: no named package above it). */
export type PackageNameCache = Map<string, string | null>;

/** The `name` of the nearest `package.json` at or above `dir` that has one. */
function packageNameOf(dir: string, cache: PackageNameCache): string | null {
  const cached = cache.get(dir);
  if (cached !== undefined) return cached;
  let found: string | null = null;
  const manifest = join(dir, 'package.json');
  if (existsSync(manifest)) {
    try {
      const name: unknown = (JSON.parse(readFileSync(manifest, 'utf-8')) as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) found = name;
    } catch {
      // Unreadable or invalid manifest: treated as absent.
    }
  }
  if (found === null) {
    const parent = dirname(dir);
    if (parent !== dir) found = packageNameOf(parent, cache);
  }
  cache.set(dir, found);
  return found;
}

/** `go.mod` lookups of one resolution run, by directory (null: no module above it). */
export type GoModuleCache = Map<string, { root: string; module: string } | null>;

/** The Go module `dir` belongs to: the nearest `go.mod` at or above it. */
function goModuleOf(dir: string, cache: GoModuleCache): { root: string; module: string } | null {
  const cached = cache.get(dir);
  if (cached !== undefined) return cached;
  let found: { root: string; module: string } | null = null;
  const manifest = join(dir, 'go.mod');
  if (existsSync(manifest)) {
    try {
      const declared = /^\s*module\s+(\S+)/m.exec(readFileSync(manifest, 'utf-8'));
      if (declared) found = { root: dir, module: declared[1].replace(/^"|"$/g, '') };
    } catch {
      // Unreadable manifest: treated as absent.
    }
  }
  if (!found) {
    const parent = dirname(dir);
    if (parent !== dir) found = goModuleOf(parent, cache);
  }
  cache.set(dir, found);
  return found;
}

/** `./a/../b` → `b`: the part of a path-like specifier that can end a file path. */
function pathEnding(specifier: string): string {
  return specifier.split('/').filter((part) => part !== '' && part !== '.' && part !== '..').join('/');
}

/**
 * A specifier that is not relative. `node:fs` is never a project file. `@/x`,
 * `~/x` and `#x` are path aliases (tsconfig `paths`, package `imports`): the
 * alias root is unknown, so the rest of the path only fixes how the file path
 * ends. Anything else names a package, which is a project file when a
 * `package.json` of the project carries that name (a workspace package).
 */
function importedEcmaScriptBare(files: ImportedFiles, spec: string): void {
  if (spec.startsWith('node:')) return;
  const parts = spec.split('/').filter((part) => part !== '');
  if (parts.length === 0) return;
  if (parts[0] === '@' || parts[0] === '~' || parts[0].startsWith('#')) {
    const rest = parts.slice(1).join('/');
    if (rest === '') return;
    const ext = extname(rest);
    const stem = JS_EXTENSIONS.has(ext) ? rest.slice(0, -ext.length) : rest;
    for (const e of SOURCE_EXTENSIONS) {
      files.addPathEnding(stem + e);
      files.addPathEnding(`${stem}/index${e}`);
    }
    return;
  }
  files.addPackage(parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
}

function importedEcmaScript(files: ImportedFiles, callerDir: string, spec: string): void {
  if (!spec.startsWith('./') && !spec.startsWith('../') && spec !== '.' && spec !== '..') {
    importedEcmaScriptBare(files, spec);
    return;
  }
  const target = resolve(callerDir, spec);
  files.addFile(target);
  const ext = extname(target);
  const stem = JS_EXTENSIONS.has(ext) ? target.slice(0, -ext.length) : target;
  for (const e of SOURCE_EXTENSIONS) {
    files.addFile(stem + e);
    files.addFile(join(target, `index${e}`));
  }
}

/** `.sibling`, `..pkg.mod`, `.` (relative to the importing package) or `pkg.mod` (under some source root). */
function importedPython(files: ImportedFiles, callerDir: string, spec: string): void {
  const dots = /^\.*/.exec(spec)![0].length;
  const parts = spec.slice(dots).split('.').filter((part) => part !== '');
  if (dots > 0) {
    let base = callerDir;
    for (let i = 1; i < dots; i++) base = dirname(base);
    const target = join(base, ...parts);
    for (const e of PYTHON_EXTENSIONS) {
      if (parts.length > 0) files.addFile(target + e);
      files.addFile(join(target, `__init__${e}`));
    }
    return;
  }
  if (parts.length === 0) return;
  for (const e of PYTHON_EXTENSIONS) {
    files.addPathEnding(parts.join('/') + e);
    files.addPathEnding(`${parts.join('/')}/__init__${e}`);
  }
}

/** A package of the module declared in the nearest `go.mod`; other imports are not project files. */
function importedGo(files: ImportedFiles, callerDir: string, spec: string, cache: GoModuleCache): void {
  const mod = goModuleOf(callerDir, cache);
  if (!mod) return;
  if (spec === mod.module) files.addDirectory(mod.root);
  else if (spec.startsWith(`${mod.module}/`)) files.addDirectory(join(mod.root, spec.slice(mod.module.length + 1)));
}

/** `#include "dir/x.h"`: next to the including file or under an include path, plus the sources named `x`. */
function importedCFamily(files: ImportedFiles, callerDir: string, spec: string): void {
  const ext = extname(spec);
  const stem = ext ? spec.slice(0, -ext.length) : spec;
  const ending = pathEnding(stem);
  if (!ending) return;
  for (const e of new Set([ext, ...C_FAMILY_EXTENSIONS])) {
    files.addFile(resolve(callerDir, stem + e));
    files.addPathEnding(ending + e);
  }
}

/** `require_relative 'x'` (from the requiring file) or `require 'lib/x'` (under some load path). */
function importedRuby(files: ImportedFiles, callerDir: string, spec: string): void {
  const withExt = extname(spec) ? spec : `${spec}.rb`;
  files.addFile(resolve(callerDir, withExt));
  const ending = pathEnding(withExt);
  if (ending && !spec.startsWith('.')) files.addPathEnding(ending);
}

/**
 * Project files the import specifiers of `callerFile` may refer to, by the
 * rules of the caller's language (TypeScript/JavaScript, Python, Go, C, C++,
 * Ruby; other languages store no import relations). Imports of the standard
 * library and of packages that are not part of the project map to nothing.
 *
 * @param goModules - `go.mod` lookups to share between the files of one run
 * @param packageNames - `package.json` lookups to share between the files of one run
 */
export function importedFiles(
  callerFile: string,
  specifiers: string[],
  goModules: GoModuleCache = new Map(),
  packageNames: PackageNameCache = new Map(),
): ImportedFiles {
  const files = new ImportedFiles(packageNames);
  const callerDir = dirname(callerFile);
  const language = languageForPath(callerFile);
  for (const spec of specifiers) {
    if (language === 'python') importedPython(files, callerDir, spec);
    else if (language === 'go') importedGo(files, callerDir, spec, goModules);
    else if (language === 'c' || language === 'cpp') importedCFamily(files, callerDir, spec);
    else if (language === 'ruby') importedRuby(files, callerDir, spec);
    else importedEcmaScript(files, callerDir, spec);
  }
  return files;
}

/** Receivers that stand for the object whose method is running. */
const SELF_RECEIVERS: ReadonlySet<string> = new Set(['this', 'self', '$this', 'Self', 'cls']);
/** Receivers that stand for the parent class: the target is not a member of the caller's own class. */
const PARENT_RECEIVERS: ReadonlySet<string> = new Set(['super', 'base', 'parent']);

/** What the resolver knows about one call besides the callee name. */
export interface CallContext {
  /** `RelationRow.receiver`: absent or null for `f()`. */
  receiver?: string | null;
  /** Id of the class the calling method or function is declared in. */
  callerParent?: string | null;
}

/**
 * True if `receiver` names what `candidate` is declared in: its class or
 * namespace, its file (`util::clamp()` → `util.rs`, `util.clamp()` →
 * `util.lua`) or its directory (a Go package, `util/mod.rs`). A path through
 * a module can call a free function; a value cannot.
 */
function namesContainer(receiver: string, candidate: CallTargetCandidate): boolean {
  if (candidate.container === receiver) return true;
  const file = candidate.file_path;
  return basename(file, extname(file)) === receiver || basename(dirname(file)) === receiver;
}

/**
 * The candidates a call with this receiver can target (the member-call rule):
 * a call with a receiver — `a.b()`, `a?.b()`, `a::b()`, `a->b()` — is a call
 * of a member, so it is linked to a method, to a function stored as a
 * property, to a class (`ns.Item()`), or to a function of the module, class
 * or namespace the receiver names. It is never linked to a free function or
 * to a variable that merely has the same name. The receiver's type is not
 * resolved, with one exception: `this.b()` / `self.b()` is first looked up
 * among the members of the caller's own class (`decided`), and `super.b()`
 * never is.
 */
function forReceiver(
  candidates: CallTargetCandidate[],
  call: CallContext,
): { candidates: CallTargetCandidate[]; decided?: string | null } {
  const receiver = call.receiver;
  if (receiver === undefined || receiver === null) return { candidates };
  let pool = candidates;
  if (call.callerParent) {
    if (SELF_RECEIVERS.has(receiver)) {
      const own = pool.filter((c) => c.parent_id === call.callerParent);
      if (own.length > 0) return { candidates: own, decided: own.length === 1 ? own[0].id : null };
    } else if (PARENT_RECEIVERS.has(receiver)) {
      pool = pool.filter((c) => c.parent_id !== call.callerParent);
    }
  }
  return { candidates: pool.filter((c) => c.member || c.type || namesContainer(receiver, c)) };
}

/** True if a call from `callerFile` can name `candidate`, which is in another file reached through `tier`. */
function reaches(candidate: CallTargetCandidate, callerDir: string, tier: 'import' | 'directory' | 'project'): boolean {
  switch (candidate.reach) {
    case undefined:
      return true;
    case 'file':
      return false;
    case 'include':
      return tier === 'import';
    case 'directory':
      return dirname(candidate.file_path) === callerDir;
  }
}

/**
 * Picks the symbol a call from `callerFile` targets among same-named
 * candidates, by closest scope:
 *   1. the caller's own file,
 *   2. files the caller imports (see `importedFiles`),
 *   3. the caller's directory (a Go package; Python sibling modules),
 *   4. the whole project.
 * The first tier with any candidate decides: exactly one → that symbol;
 * several → ambiguous, returns `null` (no fan-out to every same-named symbol).
 *
 * Two rules narrow the candidates first. Visibility: a candidate is only
 * counted in a tier it can be called from (`CallTargetCandidate.reach`), so a
 * module-private symbol is never the target of a call in another file,
 * however unique its name is. Member calls: see `forReceiver`.
 *
 * Calls of an imported name are decided before this by `resolveCall`.
 */
export function pickCallTarget(
  callerFile: string,
  candidates: CallTargetCandidate[],
  imported: { has(file: string): boolean },
  call: CallContext = {},
): string | null {
  const narrowed = forReceiver(candidates, call);
  if (narrowed.decided !== undefined) return narrowed.decided;
  const callerDir = dirname(callerFile);
  const tiers: Array<(c: CallTargetCandidate) => boolean> = [
    (c) => c.file_path === callerFile,
    (c) => imported.has(c.file_path) && reaches(c, callerDir, 'import'),
    (c) => dirname(c.file_path) === callerDir && reaches(c, callerDir, 'directory'),
    (c) => reaches(c, callerDir, 'project'),
  ];
  for (const inTier of tiers) {
    const hits = narrowed.candidates.filter(inTier);
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) return null;
  }
  return null;
}

/** How far a name is followed through files that re-export it (`export { x } from './x.js'`). */
const MAX_REEXPORT_DEPTH = 3;

/** A name bound by an import of the calling file. */
interface ImportBinding {
  specifier: string;
  /** The name stands for the module itself (`import * as m`, a Go package). */
  module: boolean;
}

/** The last element of a Go import path that names the package (`example.com/m/util/v2` → `util`). */
function goPackageName(specifier: string): string | undefined {
  const parts = specifier.split('/').filter((part) => part !== '');
  const last = parts[parts.length - 1];
  return last !== undefined && /^v\d+$/.test(last) && parts.length > 1 ? parts[parts.length - 2] : last;
}

/** The imports of one file, as the resolver uses them. Build it once per file of a run. */
export class FileImports {
  /** Every file the imports of this file may refer to (tier 2 of `pickCallTarget`). */
  readonly files: ImportedFiles;
  private readonly bindings = new Map<string, ImportBinding>();
  private readonly bySpecifier = new Map<string, ImportedFiles>();
  private readonly language: string | undefined;

  constructor(
    readonly file: string,
    imports: readonly StoredImport[],
    private readonly goModules: GoModuleCache = new Map(),
    private readonly packageNames: PackageNameCache = new Map(),
  ) {
    this.language = languageForPath(file);
    this.files = importedFiles(file, imports.map((i) => i.specifier), goModules, packageNames);
    for (const { specifier, names } of imports) {
      const bound = decodeImportedNames(names);
      for (const { name, module } of bound) this.bind(name, specifier, module === true);
      // A Go import without an alias is used by its package name.
      if (this.language === 'go' && bound.length === 0) {
        const name = goPackageName(specifier);
        if (name) this.bind(name, specifier, true);
      }
    }
  }

  private bind(name: string, specifier: string, module: boolean): void {
    if (!this.bindings.has(name)) this.bindings.set(name, { specifier, module });
  }

  /** The import that binds `name` in this file, if any. */
  binding(name: string): ImportBinding | undefined {
    return this.bindings.get(name);
  }

  /** The project files `specifier` may refer to. */
  filesOf(specifier: string): ImportedFiles {
    let files = this.bySpecifier.get(specifier);
    if (!files) {
      files = importedFiles(this.file, [specifier], this.goModules, this.packageNames);
      this.bySpecifier.set(specifier, files);
    }
    return files;
  }

  /**
   * The specifier of the module that `name`, imported from `binding`, may
   * itself be: Python's `from pkg import mod` binds a submodule like a name.
   */
  submodule(binding: ImportBinding, name: string): string | undefined {
    if (this.language !== 'python' || binding.module) return undefined;
    return binding.specifier.endsWith('.') ? `${binding.specifier}${name}` : `${binding.specifier}.${name}`;
  }
}

/** Reads the imports of a project file; used to follow re-exports. */
export type ImportLookup = (file: string) => FileImports;

/**
 * The candidates reachable through one import of the calling file: those in
 * the files `specifier` refers to, or — when none is there — in the files
 * these import in turn, since a module that provides a name it does not
 * define re-exports it (`export { x } from './x.js'`, a Python `__init__`).
 */
function throughImport(
  imports: FileImports,
  specifier: string,
  candidates: CallTargetCandidate[],
  lookup: ImportLookup,
): CallTargetCandidate[] {
  const callerDir = dirname(imports.file);
  const visible = candidates.filter((c) => c.file_path === imports.file || reaches(c, callerDir, 'import'));
  if (visible.length === 0) return [];
  let modules: ImportedFiles[] = [imports.filesOf(specifier)];
  const visited = new Set<string>();
  for (let depth = 0; depth <= MAX_REEXPORT_DEPTH && modules.length > 0; depth++) {
    const hits = visible.filter((c) => modules.some((m) => m.has(c.file_path)));
    if (hits.length > 0) return hits;
    const next: ImportedFiles[] = [];
    for (const module of modules) {
      for (const file of module) {
        if (visited.has(file)) continue;
        visited.add(file);
        next.push(lookup(file).files);
      }
    }
    modules = next;
  }
  return [];
}

function unique(hits: CallTargetCandidate[]): string | null {
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * The symbol a call targets, or null when it stays unresolved.
 *
 * A definition in the caller's own file wins (the closest scope). Otherwise
 * the imports of the calling file decide whenever they say where the name
 * comes from (the import rule):
 *
 * - `name()` where `name` is bound by an import: only a definition reachable
 *   through that import is a candidate. When the import leads to no project
 *   file — a package or a built-in such as `node:path` — the call is external
 *   and stays unresolved, whatever else in the project has that name.
 * - `ns.name()` where `ns` is bound to a module (`import * as ns`, a Go
 *   package, Python's `import pkg.mod`): the same, and any callable of that
 *   module is a candidate, since the receiver is a module and not a value.
 * - `obj.name()` where `obj` is an imported value: a definition in the
 *   imported file is preferred; without one the call is an ordinary member
 *   call.
 *
 * Everything else goes through the tiers of `pickCallTarget`.
 */
export function resolveCall(
  name: string,
  candidates: CallTargetCandidate[],
  imports: FileImports,
  call: CallContext = {},
  lookup: ImportLookup = (file) => new FileImports(file, []),
): string | null {
  if (candidates.length === 0) return null;
  const callerFile = imports.file;
  const receiver = call.receiver ?? undefined;

  const narrowed = forReceiver(candidates, call);
  if (narrowed.decided !== undefined) return narrowed.decided;
  const own = narrowed.candidates.filter((c) => c.file_path === callerFile);
  if (own.length > 0) return unique(own);

  if (receiver === undefined) {
    const binding = imports.binding(name);
    if (binding) return unique(throughImport(imports, binding.specifier, candidates, lookup));
  } else {
    const binding = imports.binding(receiver);
    if (binding) {
      const specifier = imports.submodule(binding, receiver) ?? binding.specifier;
      const hits = throughImport(imports, specifier, candidates, lookup);
      if (hits.length > 0 || binding.module) return unique(hits);
      if (specifier !== binding.specifier) {
        const members = throughImport(imports, binding.specifier, narrowed.candidates, lookup);
        if (members.length > 0) return unique(members);
      }
    }
  }
  return pickCallTarget(callerFile, candidates, imports.files, call);
}

/**
 * Links `calls` relations to their target symbols (see `resolveCall`).
 * Run after a batch of files is written to the store; pass a scope on
 * incremental updates so only affected relations are revisited.
 */
export function resolveCallRelations(store: SqliteStore, scope?: CallResolutionScope): number {
  const rows = store.getCallRelationsToResolve(scope);
  const candidatesByName = new Map<string, CallTargetCandidate[]>();
  const importsByFile = new Map<string, FileImports>();
  const parentByCaller = new Map<string, string | null>();
  const goModules: GoModuleCache = new Map();
  const packageNames: PackageNameCache = new Map();
  const updates: Array<{ rowid: number; to_id: string }> = [];

  const importsOf: ImportLookup = (file) => {
    let imports = importsByFile.get(file);
    if (!imports) {
      imports = new FileImports(file, store.getImports(file), goModules, packageNames);
      importsByFile.set(file, imports);
    }
    return imports;
  };
  /** The class of the caller, looked up only for the receivers that need it. */
  const parentOf = (callerId: string): string | null => {
    let parent = parentByCaller.get(callerId);
    if (parent === undefined) {
      parent = store.getSymbolById(callerId)?.parent_id ?? null;
      parentByCaller.set(callerId, parent);
    }
    return parent;
  };

  for (const row of rows) {
    let candidates = candidatesByName.get(row.to_name);
    if (!candidates) {
      candidates = store.getCallTargetCandidates(row.to_name);
      candidatesByName.set(row.to_name, candidates);
    }
    let target: string | null = null;
    if (candidates.length > 0) {
      const needsParent = row.receiver !== null && (SELF_RECEIVERS.has(row.receiver) || PARENT_RECEIVERS.has(row.receiver));
      const call: CallContext = { receiver: row.receiver, callerParent: needsParent ? parentOf(row.from_id) : null };
      target = resolveCall(row.to_name, candidates, importsOf(row.file_path), call, importsOf);
    }
    const toId = target ?? unresolvedCallId(row.to_name);
    if (toId !== row.to_id) updates.push({ rowid: row.rowid, to_id: toId });
  }

  store.setRelationTargets(updates);
  log.debug({ examined: rows.length, updated: updates.length }, 'Call relations resolved');
  return updates.length;
}
