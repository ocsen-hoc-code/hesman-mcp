import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { makeSymbolId, type ExtractedSymbol } from './core.js';
import type { LanguageProfile } from './language-profile.js';
import type { ImportedName, ParsedReferences } from './tags-engine.js';

export interface RelationRow {
  from_id: string;
  to_id: string;
  kind: 'calls' | 'extends' | 'implements' | 'imports' | 'contains' | 'references';
  file_path: string;
  line: number;
  col: number;
  /** Callee name of a `calls` relation; `resolveCallRelations` turns it into `to_id`. */
  to_name?: string | null;
  /**
   * Receiver of a `calls` relation, as recorded by `CallSite.receiver`: absent
   * for `f()`, the receiver's last name for `a.f()`, `*` when it has none.
   */
  receiver?: string | null;
  /**
   * Declared type of the receiver of a `calls` relation (`CallSite.receiverType`):
   * null when the file does not declare it. Stored as `relations.receiver_type`.
   */
  receiverType?: string | null;
  /** Names bound by an `imports` relation (see `encodeImportedNames`). */
  names?: string | null;
}

/** Marks a name that stands for the imported module itself in `RelationRow.names`. */
export const MODULE_NAME_MARK = '*';

/**
 * The names an import binds, as stored: separated by spaces, in source order,
 * a module name prefixed with `*` (`join abs`, `*os`). Null when it binds none.
 */
export function encodeImportedNames(names: readonly ImportedName[] | undefined): string | null {
  if (!names || names.length === 0) return null;
  return names.map((n) => (n.module ? `${MODULE_NAME_MARK}${n.name}` : n.name)).join(' ');
}

/** The inverse of `encodeImportedNames`. */
export function decodeImportedNames(names: string | null | undefined): ImportedName[] {
  if (!names) return [];
  return names.split(' ').filter((n) => n.length > 0).map((n) =>
    n.startsWith(MODULE_NAME_MARK) ? { name: n.slice(MODULE_NAME_MARK.length), module: true as const } : { name: n },
  );
}

/** Prefix of the placeholder `to_id` of a call that is not linked to a symbol. */
export const UNRESOLVED_CALL_PREFIX = 'call:';

/** Placeholder `to_id` for a call to `name` that does not (yet) resolve. */
export function unresolvedCallId(name: string): string {
  return `${UNRESOLVED_CALL_PREFIX}${name}`;
}

/** Prefix of the `from_id` of a call made outside every function, method and class. */
export const MODULE_CALLER_PREFIX = 'module:';

/**
 * Source of a call made at the top level of `filePath` (or inside a callback
 * that has no name there). It is not a symbol: the call site is kept, so
 * references and impact analysis still see it, without a made-up caller.
 * The path is hashed like a symbol id, since the id is stored with every such
 * call and the relation already carries the file path.
 */
export function moduleCallerId(filePath: string): string {
  return `${MODULE_CALLER_PREFIX}${createHash('sha256').update(filePath).digest('hex').slice(0, 16)}`;
}

function findSymbolByName(
  symbols: ExtractedSymbol[],
  name: string,
  kind?: string,
): ExtractedSymbol | undefined {
  return symbols.find(s => {
    if (s.name !== name) return false;
    if (kind && s.kind !== kind) return false;
    return true;
  });
}

/**
 * Builds the relations of one file.
 *
 * Calls and imports come from the syntax tree: `references` is
 * `ParseResult.references` of the same file (the `@reference.call` /
 * `@reference.import` captures of the language's query layers, see
 * `TagsQuery.relations`). Without it no call and no import is reported.
 * `extends` / `implements` are still matched in the source text.
 *
 * A call belongs to the innermost enclosing function, method, class or
 * function-valued variable (`CallSite.caller`). A call that none of them
 * encloses is kept with the module as its source (`moduleCallerId`): the
 * initializer of a module-level constant, a script's top-level statements, a
 * test callback. It is never attributed to a plain variable.
 * The callee is recorded by name (`to_name` + placeholder `to_id`);
 * `resolveCallRelations` links it to a symbol once all files are indexed, so
 * calls into other files resolve and survive re-indexing of the callee's file.
 */
export function extractRelations(
  symbols: ExtractedSymbol[],
  source: string,
  filePath: string,
  profile: LanguageProfile,
  references?: ParsedReferences,
): RelationRow[] {
  if (!profile.relationQueries) return [];

  const results: RelationRow[] = [];

  // If no source provided, read it from disk
  const sourceCode = source || readFileSync(filePath, 'utf-8');

  // Build a symbol map: name -> ExtractedSymbol[]
  const nameMap = new Map<string, ExtractedSymbol[]>();
  for (const sym of symbols) {
    const existing = nameMap.get(sym.name) || [];
    existing.push(sym);
    nameMap.set(sym.name, existing);
  }

  const symbolIds = new Set(symbols.map((s) => s.id));
  const moduleId = moduleCallerId(filePath);
  for (const call of references?.calls ?? []) {
    const callerId = call.caller ? makeSymbolId(filePath, call.caller.name, call.caller.kind, call.caller.line) : moduleId;
    results.push({
      // A caller that is not a stored symbol (dropped by a profile hook) leaves the call to the module.
      from_id: symbolIds.has(callerId) ? callerId : moduleId,
      to_id: unresolvedCallId(call.name),
      to_name: call.name,
      kind: 'calls',
      file_path: filePath,
      line: call.line,
      col: call.col,
      receiver: call.receiver ?? null,
      receiverType: call.receiverType ?? null,
    });
  }

  // File-level imports have no containing symbol: they are recorded on the
  // first symbol of the file, or on the module when the file defines nothing
  // (a file that only re-exports), so the relation is still stored.
  for (const site of references?.imports ?? []) {
    const importer = symbols.find((s) => s.start_line <= site.line && s.end_line >= site.line) ?? symbols[0];
    results.push({
      from_id: importer?.id ?? moduleId,
      to_id: `unresolved:${site.specifier}`,
      kind: 'imports',
      file_path: filePath,
      line: site.line,
      col: site.col,
      names: encodeImportedNames(site.names),
    });
  }

  let match: RegExpExecArray | null;

  // EXTENDS: match `class X extends Y`
  const extendsRegex = /class\s+(\w+)\s+extends\s+(\w+)/g;
  while ((match = extendsRegex.exec(sourceCode)) !== null) {
    const className = match[1];
    const parentName = match[2];
    const line = sourceCode.substring(0, match.index).split('\n').length; // 1-based
    const classSymbol = findSymbolByName(symbols, className, 'class');
    const parentSymbol = findSymbolByName(symbols, parentName, 'class') || nameMap.get(parentName)?.[0];
    if (classSymbol && parentSymbol) {
      results.push({
        from_id: classSymbol.id,
        to_id: parentSymbol.id,
        kind: 'extends',
        file_path: filePath,
        line,
        col: 0,
      });
    }
  }

  // IMPLEMENTS: match `class X implements Y`
  const implementsRegex = /class\s+(\w+)\s+implements\s+(\w+)/g;
  while ((match = implementsRegex.exec(sourceCode)) !== null) {
    const className = match[1];
    const ifaceName = match[2];
    const line = sourceCode.substring(0, match.index).split('\n').length; // 1-based
    const classSymbol = findSymbolByName(symbols, className, 'class');
    const ifaceSymbol = findSymbolByName(symbols, ifaceName, 'interface') || nameMap.get(ifaceName)?.[0];
    if (classSymbol && ifaceSymbol) {
      results.push({
        from_id: classSymbol.id,
        to_id: ifaceSymbol.id,
        kind: 'implements',
        file_path: filePath,
        line,
        col: 0,
      });
    }
  }

  return results;
}
