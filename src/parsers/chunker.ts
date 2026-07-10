import type { ExtractedSymbol } from './core';

export interface CodeChunk {
  symbolId: string;
  text: string;
  symbol: ExtractedSymbol;
}

/**
 * Convert parsed symbols into embeddable chunks.
 * Each symbol = 1 chunk. Text = [signature]\n[docComment]\n[code].
 */
export function chunkSymbols(
  symbols: ExtractedSymbol[],
  sourceLines: string[],
): CodeChunk[] {
  return symbols.map(sym => {
    const code = sourceLines
      .slice(sym.start_line, sym.end_line + 1)
      .join('\n');

    const parts: string[] = [];
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
