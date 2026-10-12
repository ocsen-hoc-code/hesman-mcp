import { readFileSync } from 'node:fs';
import type { ExtractedSymbol } from './core.js';
import type { LanguageProfile } from './language-profile.js';
import type { ParsedReferences } from './tags-engine.js';

export interface RelationRow {
  from_id: string;
  to_id: string;
  kind: 'calls' | 'extends' | 'implements' | 'imports' | 'contains' | 'references';
  file_path: string;
  line: number;
  col: number;
  /** Callee name of a `calls` relation; `resolveCallRelations` turns it into `to_id`. */
  to_name?: string | null;
}

/** Prefix of the placeholder `to_id` of a call that is not linked to a symbol. */
export const UNRESOLVED_CALL_PREFIX = 'call:';

/** Placeholder `to_id` for a call to `name` that does not (yet) resolve. */
export function unresolvedCallId(name: string): string {
  return `${UNRESOLVED_CALL_PREFIX}${name}`;
}

/** Kinds that own a call in preference to an enclosing non-callable symbol. */
const CALLABLE_KINDS = new Set(['function', 'method']);

/**
 * The symbol a call on `line` belongs to: the innermost function/method whose
 * range contains the line, otherwise the innermost symbol of any kind.
 */
function innermostSymbolAt(symbols: ExtractedSymbol[], line: number): ExtractedSymbol | undefined {
  const span = (s: ExtractedSymbol): number => s.end_line - s.start_line;
  let best: ExtractedSymbol | undefined;
  for (const s of symbols) {
    if (s.start_line > line || s.end_line < line) continue;
    if (!best) {
      best = s;
      continue;
    }
    const callable = CALLABLE_KINDS.has(s.kind);
    if (callable !== CALLABLE_KINDS.has(best.kind)) {
      if (callable) best = s;
      continue;
    }
    if (span(s) < span(best) || (span(s) === span(best) && s.start_line > best.start_line)) best = s;
  }
  return best;
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
 * A call belongs to the innermost function or method that contains its line.
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

  for (const call of references?.calls ?? []) {
    const caller = innermostSymbolAt(symbols, call.line);
    if (!caller) continue;
    results.push({
      from_id: caller.id,
      to_id: unresolvedCallId(call.name),
      to_name: call.name,
      kind: 'calls',
      file_path: filePath,
      line: call.line,
      col: call.col,
    });
  }

  // File-level imports have no containing symbol: they are recorded on the
  // first symbol of the file so the relation is still stored.
  for (const site of references?.imports ?? []) {
    const importer = symbols.find((s) => s.start_line <= site.line && s.end_line >= site.line) ?? symbols[0];
    if (!importer) continue;
    results.push({
      from_id: importer.id,
      to_id: `unresolved:${site.specifier}`,
      kind: 'imports',
      file_path: filePath,
      line: site.line,
      col: site.col,
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
