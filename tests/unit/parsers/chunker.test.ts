import { describe, it, expect } from 'vitest';
import { chunkSymbols, splitIdentifier } from '../../../src/parsers/chunker';
import type { ExtractedSymbol } from '../../../src/parsers/core';

describe('chunkSymbols', () => {
  const makeSym = (overrides: Partial<ExtractedSymbol> = {}): ExtractedSymbol => ({
    id: 'abc123',
    name: 'myFunc',
    kind: 'function',
    file_path: 'src/test.ts',
    start_line: 1, // 1-based, inclusive
    end_line: 4,
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
    expect(chunks[0].text.endsWith(sourceLines.join('\n'))).toBe(true);
  });

  it('handles empty symbols array', () => {
    const chunks = chunkSymbols([], []);
    expect(chunks).toEqual([]);
  });

  it('chunk text includes only the symbol line range', () => {
    const sym = makeSym({ start_line: 2, end_line: 2, signature: null, doc_comment: null });
    const chunks = chunkSymbols([sym], sourceLines);
    expect(chunks[0].text.endsWith('\nfunction myFunc(x: number): number {')).toBe(true);
    expect(chunks[0].text).not.toContain('return x * 2;');
  });

  it('skips variables and constants declared inside a function or method body', () => {
    const fn = makeSym({ id: 'fn', name: 'calc', kind: 'function', start_line: 2, end_line: 4 });
    const local = makeSym({ id: 'local', name: 'total', kind: 'variable', start_line: 3, end_line: 3 });
    const localConst = makeSym({ id: 'localConst', name: 'LIMIT', kind: 'constant', start_line: 3, end_line: 3 });
    const method = makeSym({ id: 'm', name: 'run', kind: 'method', start_line: 6, end_line: 8 });
    const methodLocal = makeSym({ id: 'mLocal', name: 'err', kind: 'variable', start_line: 7, end_line: 7 });
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);

    const ids = chunkSymbols([fn, local, localConst, method, methodLocal], lines).map(c => c.symbolId);

    expect(ids).toEqual(['fn', 'm']);
  });

  it('keeps module-level variables, class fields and nested functions', () => {
    const moduleVar = makeSym({ id: 'moduleVar', name: 'EMAIL_PATTERN', kind: 'constant', start_line: 1, end_line: 1 });
    const cls = makeSym({ id: 'cls', name: 'Cart', kind: 'class', start_line: 2, end_line: 9 });
    const field = makeSym({ id: 'field', name: 'items', kind: 'variable', start_line: 3, end_line: 3 });
    const fn = makeSym({ id: 'fn', name: 'outer', kind: 'function', start_line: 10, end_line: 14 });
    const inner = makeSym({ id: 'inner', name: 'inner', kind: 'function', start_line: 11, end_line: 13 });
    const lines = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`);

    const ids = chunkSymbols([moduleVar, cls, field, fn, inner], lines).map(c => c.symbolId);

    expect(ids).toEqual(['moduleVar', 'cls', 'field', 'fn', 'inner']);
  });

  it('starts the chunk text with the kind and the name split into words', () => {
    const sym = makeSym({ name: 'calculateCartTotal', kind: 'function' });
    const chunks = chunkSymbols([sym], sourceLines);
    expect(chunks[0].text.split('\n')[0]).toBe('function calculate cart total');
  });
});

describe('splitIdentifier', () => {
  it('splits camelCase, PascalCase, snake_case and acronyms into lowercase words', () => {
    expect(splitIdentifier('tsFormatName')).toEqual(['ts', 'format', 'name']);
    expect(splitIdentifier('GoFormatName')).toEqual(['go', 'format', 'name']);
    expect(splitIdentifier('py_format_name')).toEqual(['py', 'format', 'name']);
    expect(splitIdentifier('parseHTTPRequest')).toEqual(['parse', 'http', 'request']);
    expect(splitIdentifier('EMAIL_PATTERN')).toEqual(['email', 'pattern']);
    expect(splitIdentifier('sha256Hash')).toEqual(['sha256', 'hash']);
  });

  it('returns an empty list for a name without letters or digits', () => {
    expect(splitIdentifier('$_')).toEqual([]);
  });
});
