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

/**
 * Convert parsed symbols into embeddable chunks.
 * Each symbol = 1 chunk. Text = [kind + name words]\n[signature]\n[docComment]\n[code].
 * The name words put the symbol's intent in natural language, which the
 * embedding model matches far better than an identifier like `GoFormatName`.
 */
export function chunkSymbols(
  symbols: ExtractedSymbol[],
  sourceLines: string[],
): CodeChunk[] {
  return symbols.map(sym => {
    const code = sourceLines
      .slice(sym.start_line, sym.end_line + 1)
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
