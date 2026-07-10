import { describe, it, expect } from 'vitest';
import { chunkSymbols, type CodeChunk } from '../../../src/parsers/chunker';
import type { ExtractedSymbol } from '../../../src/parsers/core';

describe('chunkSymbols', () => {
  const makeSym = (overrides: Partial<ExtractedSymbol> = {}): ExtractedSymbol => ({
    id: 'abc123',
    name: 'myFunc',
    kind: 'function',
    file_path: 'src/test.ts',
    start_line: 0,
    end_line: 3,
    start_col: 0,
    end_col: 10,
    signature: 'function myFunc(x: number): number',
    doc_comment: '/** Does a thing */',
    parent_id: null,
    language: 'typescript',
    is_exported: 1,
    ...overrides,
  });

  const sourceLines = [
    '',
    'function myFunc(x: number): number {',
    '  return x * 2;',
    '}',
  ];

  it('includes signature, doc, and code in chunk text', () => {
    const chunks = chunkSymbols([makeSym()], sourceLines);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].symbolId).toBe('abc123');
    expect(chunks[0].text).toContain('function myFunc(x: number): number');
    expect(chunks[0].text).toContain('/** Does a thing */');
    expect(chunks[0].text).toContain('return x * 2;');
  });

  it('handles symbol without docComment', () => {
    const sym = makeSym({ doc_comment: null });
    const chunks = chunkSymbols([sym], sourceLines);
    expect(chunks[0].text).not.toContain('/**');
  });

  it('handles symbol without signature', () => {
    const sym = makeSym({ signature: null, doc_comment: null });
    const chunks = chunkSymbols([sym], sourceLines);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(sourceLines.join('\n'));
  });

  it('handles empty symbols array', () => {
    const chunks = chunkSymbols([], []);
    expect(chunks).toEqual([]);
  });

  it('chunk text includes only the symbol line range', () => {
    const sym = makeSym({ start_line: 1, end_line: 1, signature: null, doc_comment: null });
    const chunks = chunkSymbols([sym], sourceLines);
    expect(chunks[0].text).toBe('function myFunc(x: number): number {');
  });
});
