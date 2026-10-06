import type { ExtractedSymbol } from './core.js';

export interface CodeChunk {
  symbolId: string;
  text: string;
  symbol: ExtractedSymbol;
}

/**
 * Split an identifier into lowercase words: camelCase, PascalCase, snake_case,
 * kebab-case and acronyms (`parseHTTPRequest` -> parse, http, request).
 */
export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(word => word.length > 0)
    .map(word => word.toLowerCase());
}

const BODY_KINDS = new Set(['function', 'method']);
const VALUE_KINDS = new Set(['variable', 'constant']);

/** Position-wise comparison of (line, column) pairs. */
function before(lineA: number, colA: number, lineB: number, colB: number): boolean {
  return lineA < lineB || (lineA === lineB && colA < colB);
}

/** True if `inner` lies strictly inside `outer` (same file assumed). */
function strictlyInside(inner: ExtractedSymbol, outer: ExtractedSymbol): boolean {
  const startsAfter = !before(inner.start_line, inner.start_col, outer.start_line, outer.start_col);
  const endsBefore = !before(outer.end_line, outer.end_col, inner.end_line, inner.end_col);
  const sameRange = inner.start_line === outer.start_line && inner.start_col === outer.start_col
    && inner.end_line === outer.end_line && inner.end_col === outer.end_col;
  return startsAfter && endsBefore && !sameRange;
}

/**
 * True for a variable/constant declared inside a function or method body
 * (`total`, `err`, ...). The parser keeps these for other tools, but as search
 * results they only crowd out the functions that declare them. Nesting is
 * decided by source range because the parser's `parent_id` points at the
 * enclosing class, not at the enclosing function.
 */
function isFunctionLocal(sym: ExtractedSymbol, fileSymbols: readonly ExtractedSymbol[]): boolean {
  if (!VALUE_KINDS.has(sym.kind)) return false;
  return fileSymbols.some(other => other !== sym && BODY_KINDS.has(other.kind) && strictlyInside(sym, other));
}

/**
 * Convert parsed symbols into embeddable chunks.
 * `symbols` are the symbols of one file; function-local variables are skipped.
 * Each symbol = 1 chunk. Text = [kind + name words]\n[signature]\n[docComment]\n[code].
 * The name words put the symbol's intent in natural language, which the
 * embedding model matches far better than an identifier like `GoFormatName`.
 */
export function chunkSymbols(
  symbols: ExtractedSymbol[],
  sourceLines: string[],
): CodeChunk[] {
  return symbols.filter(sym => !isFunctionLocal(sym, symbols)).map(sym => {
    const code = sourceLines
      .slice(sym.start_line - 1, sym.end_line) // lines are 1-based, inclusive
      .join('\n');

    const parts: string[] = [[sym.kind, ...splitIdentifier(sym.name)].join(' ')];
    if (sym.signature) parts.push(sym.signature);
    if (sym.doc_comment) parts.push(sym.doc_comment);
    parts.push(code);

    return {
      symbolId: sym.id,
      text: parts.join('\n'),
      symbol: sym,
    };
  });
}
