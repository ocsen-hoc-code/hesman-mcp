import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { languageById, languageForPath } from '../parsers/languages.js';
import type { CallTargetCandidate, SqliteStore } from '../stores/sqlite.js';
import { unresolvedCallId } from '../parsers/relation-extractor.js';
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

  has(file: string): boolean {
    if (this.files.has(file) || this.directories.has(dirname(file))) return true;
    for (const suffix of this.suffixes) {
      if (file.endsWith(suffix)) return true;
    }
    return false;
  }

  /** The files named exactly. */
  [Symbol.iterator](): IterableIterator<string> {
    return this.files.values();
  }
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

function importedEcmaScript(files: ImportedFiles, callerDir: string, spec: string): void {
  // Package imports (`react`, `node:fs`) are not project files.
  if (!spec.startsWith('./') && !spec.startsWith('../')) return;
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
 * Ruby; other languages store no import relations). Imports of packages and
 * of the standard library map to nothing: they are not project files.
 *
 * @param goModules - `go.mod` lookups to share between the files of one run
 */
export function importedFiles(callerFile: string, specifiers: string[], goModules: GoModuleCache = new Map()): ImportedFiles {
  const files = new ImportedFiles();
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
 * A `same_file_only` candidate (a non-exported function assigned to an object
 * key or property) only exists for tier 1: a bare `name()` in another file
 * cannot reach it, so it is neither picked nor counted in tiers 2–4.
 */
export function pickCallTarget(
  callerFile: string,
  candidates: CallTargetCandidate[],
  imported: { has(file: string): boolean },
): string | null {
  const callerDir = dirname(callerFile);
  const tiers: Array<(c: CallTargetCandidate) => boolean> = [
    (c) => c.file_path === callerFile,
    (c) => imported.has(c.file_path),
    (c) => dirname(c.file_path) === callerDir,
    () => true,
  ];
  for (const [tier, inTier] of tiers.entries()) {
    const hits = candidates.filter((c) => inTier(c) && (tier === 0 || !c.same_file_only));
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * Links `calls` relations to their target symbols (see `pickCallTarget`).
 * Run after a batch of files is written to the store; pass a scope on
 * incremental updates so only affected relations are revisited.
 */
export function resolveCallRelations(store: SqliteStore, scope?: CallResolutionScope): number {
  const rows = store.getCallRelationsToResolve(scope);
  const candidatesByName = new Map<string, CallTargetCandidate[]>();
  const importsByFile = new Map<string, ImportedFiles>();
  const goModules: GoModuleCache = new Map();
  const updates: Array<{ rowid: number; to_id: string }> = [];

  for (const row of rows) {
    let candidates = candidatesByName.get(row.to_name);
    if (!candidates) {
      candidates = store.getCallTargetCandidates(row.to_name);
      candidatesByName.set(row.to_name, candidates);
    }
    let imported = importsByFile.get(row.file_path);
    if (!imported) {
      imported = importedFiles(row.file_path, store.getImportSpecifiers(row.file_path), goModules);
      importsByFile.set(row.file_path, imported);
    }
    const target = pickCallTarget(row.file_path, candidates, imported) ?? unresolvedCallId(row.to_name);
    if (target !== row.to_id) updates.push({ rowid: row.rowid, to_id: target });
  }

  store.setRelationTargets(updates);
  log.debug({ examined: rows.length, updated: updates.length }, 'Call relations resolved');
  return updates.length;
}
