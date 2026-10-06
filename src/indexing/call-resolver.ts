import { dirname, extname, join, resolve } from 'node:path';
import type { SqliteStore } from '../stores/sqlite.js';
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

/**
 * Files a relative import specifier of `callerFile` may refer to. Package
 * imports (`react`, `node:fs`) map to nothing: they are not project files.
 */
export function importedFiles(callerFile: string, specifiers: string[]): Set<string> {
  const files = new Set<string>();
  for (const spec of specifiers) {
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
    const target = resolve(dirname(callerFile), spec);
    files.add(target);
    const ext = extname(target);
    const stem = JS_EXTENSIONS.has(ext) ? target.slice(0, -ext.length) : target;
    for (const e of SOURCE_EXTENSIONS) {
      files.add(stem + e);
      files.add(join(target, `index${e}`));
    }
  }
  return files;
}

/**
 * Picks the symbol a call from `callerFile` targets among same-named
 * candidates, by closest scope:
 *   1. the caller's own file,
 *   2. files the caller imports (relative TS/JS imports),
 *   3. the caller's directory (a Go package; Python sibling modules),
 *   4. the whole project.
 * The first tier with any candidate decides: exactly one → that symbol;
 * several → ambiguous, returns `null` (no fan-out to every same-named symbol).
 */
export function pickCallTarget(
  callerFile: string,
  candidates: Array<{ id: string; file_path: string }>,
  imported: Set<string>,
): string | null {
  const callerDir = dirname(callerFile);
  const tiers: Array<(c: { file_path: string }) => boolean> = [
    (c) => c.file_path === callerFile,
    (c) => imported.has(c.file_path),
    (c) => dirname(c.file_path) === callerDir,
    () => true,
  ];
  for (const inTier of tiers) {
    const hits = candidates.filter(inTier);
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
  const candidatesByName = new Map<string, Array<{ id: string; file_path: string }>>();
  const importsByFile = new Map<string, Set<string>>();
  const updates: Array<{ rowid: number; to_id: string }> = [];

  for (const row of rows) {
    let candidates = candidatesByName.get(row.to_name);
    if (!candidates) {
      candidates = store.getCallTargetCandidates(row.to_name);
      candidatesByName.set(row.to_name, candidates);
    }
    let imported = importsByFile.get(row.file_path);
    if (!imported) {
      imported = importedFiles(row.file_path, store.getImportSpecifiers(row.file_path));
      importsByFile.set(row.file_path, imported);
    }
    const target = pickCallTarget(row.file_path, candidates, imported) ?? unresolvedCallId(row.to_name);
    if (target !== row.to_id) updates.push({ rowid: row.rowid, to_id: target });
  }

  store.setRelationTargets(updates);
  log.debug({ examined: rows.length, updated: updates.length }, 'Call relations resolved');
  return updates.length;
}
