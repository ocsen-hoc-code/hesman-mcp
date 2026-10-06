import { readFileSync } from 'node:fs';
import type { ExtractedSymbol } from './core.js';
import type { LanguageProfile } from './language-profile.js';

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

const CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'typeof', 'instanceof',
]);

/** Kinds that own a call in preference to an enclosing non-callable symbol. */
const CALLABLE_KINDS = new Set(['function', 'method']);

/** Offset of the first character of every line (index 0 is line 1). */
function lineStartOffsets(source: string): number[] {
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

/** 1-based line containing `offset`. */
function lineOf(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Offset of each symbol's name in its own declaration: the first whole-word
 * occurrence of the name from the start of the symbol's first line and inside
 * its range (skips decorators and keywords such as `func` / `export function`).
 */
function declarationOffsets(symbols: ExtractedSymbol[], source: string, lineStarts: number[]): Set<number> {
  const offsets = new Set<number>();
  for (const sym of symbols) {
    const from = lineStarts[sym.start_line - 1];
    if (from === undefined) continue;
    const to = sym.end_line < lineStarts.length ? lineStarts[sym.end_line] : source.length;
    const re = new RegExp(`(?<![\\w$])${escapeRegex(sym.name)}(?![\\w$])`, 'g');
    re.lastIndex = from;
    const found = re.exec(source);
    if (found && found.index < to) offsets.add(found.index);
  }
  return offsets;
}

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

export function extractRelations(
  symbols: ExtractedSymbol[],
  source: string,
  filePath: string,
  profile: LanguageProfile,
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

  // CALLS: match function calls like `funcName(...)`. The callee is recorded
  // by name (`to_name` + placeholder `to_id`); `resolveCallRelations` links it
  // to a symbol once all files are indexed, so calls into other files resolve
  // and survive re-indexing of the callee's file.
  const lineStarts = lineStartOffsets(sourceCode);
  const declarations = declarationOffsets(symbols, sourceCode, lineStarts);
  const callRegex = /\b([a-zA-Z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(sourceCode)) !== null) {
    const calleeName = match[1];
    if (CALL_KEYWORDS.has(calleeName)) continue;
    // The symbol's own name in its declaration (`func GoGreet(`) is not a call.
    if (declarations.has(match.index)) continue;

    const line = lineOf(lineStarts, match.index); // 1-based
    const col = match.index - lineStarts[line - 1];

    const caller = innermostSymbolAt(symbols, line);
    if (!caller) continue;
    results.push({
      from_id: caller.id,
      to_id: unresolvedCallId(calleeName),
      to_name: calleeName,
      kind: 'calls',
      file_path: filePath,
      line,
      col,
    });
  }

  // IMPORTS: match `import { ... } from '...'`
  const importRegex = /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = importRegex.exec(sourceCode)) !== null) {
    const modulePath = match[1];
    const line = sourceCode.substring(0, match.index).split('\n').length; // 1-based
    const col = match[0].indexOf('from');

    // Determine if local file or package
    const toId = `unresolved:${modulePath}`;

    // Find the symbol containing this line (the importer).
    // For file-level imports (no containing symbol), fall back to the
    // first top-level symbol in the file so the relation is still recorded.
    let importer = symbols.find(s => s.start_line <= line && s.end_line >= line);
    if (!importer && symbols.length > 0) {
      importer = symbols[0];
    }
    if (importer) {
      results.push({
        from_id: importer.id,
        to_id: toId,
        kind: 'imports',
        file_path: filePath,
        line,
        col,
      });
    }
  }

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
