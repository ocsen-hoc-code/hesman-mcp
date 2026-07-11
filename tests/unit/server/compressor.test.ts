import { describe, it, expect } from 'vitest';
import { compressToolResponse } from '../../../src/server/response-compressor';

describe('compressToolResponse', () => {
  it('returns data unchanged for index_status', () => {
    const data = { totalFiles: 10, totalSymbols: 100 };
    const result = compressToolResponse('index_status', data);
    expect(result).toEqual(data);
  });

  it('adds _meta field with token estimates', () => {
    const data = { symbols: [{ name: 'test', kind: 'function' }] };
    const result = compressToolResponse('find_symbol', data) as any;
    expect(result._meta).toBeDefined();
    expect(result._meta.layers).toBeDefined();
  });

  it('adds _summary for get_references', () => {
    const data = {
      references: [
        { filePath: 'a.ts', kind: 'calls', line: 10 },
        { filePath: 'a.ts', kind: 'calls', line: 20 },
        { filePath: 'b.ts', kind: 'imports', line: 1 },
      ],
      totalCount: 3,
    };
    const result = compressToolResponse('get_references', data) as any;
    expect(result._summary).toBeDefined();
    expect(result._summary.byKind).toBeDefined();
    expect(result._summary.byFile).toBeDefined();
  });

  it('adds _summary for get_callers', () => {
    const data = {
      callers: [
        { name: 'main', depth: 1, filePath: 'a.ts' },
        { name: 'init', depth: 1, filePath: 'b.ts' },
        { name: 'setup', depth: 2, filePath: 'c.ts' },
      ],
    };
    const result = compressToolResponse('get_callers', data) as any;
    expect(result._summary).toBeDefined();
    expect(result._summary.paths).toBeDefined();
  });

  it('compacts code with level 1 when no store provided', () => {
    const data = {
      file: 'test.ts',
      content: '// comment\nexport function add(a: number, b: number): number {\n  return a + b;\n}',
    };
    const result = compressToolResponse('get_context', data) as any;
    // Content should not have the comment
    expect(result.content).not.toContain('// comment');
    expect(result._meta).toBeDefined();
  });
});
