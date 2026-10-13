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

  it('omits _summary for get_references when it would not reduce size', () => {
    const data = {
      references: [
        { filePath: 'a.ts', kind: 'calls', line: 10 },
        { filePath: 'a.ts', kind: 'calls', line: 20 },
        { filePath: 'b.ts', kind: 'imports', line: 1 },
      ],
      totalCount: 3,
    };
    const result = compressToolResponse('get_references', data) as any;
    expect(result._summary).toBeUndefined();
    expect(result.references).toEqual(data.references);
    expect(result._meta.compressed).toBe(false);
  });

  it('omits _summary for get_callers when it would not reduce size', () => {
    const data = {
      callers: [
        { name: 'main', depth: 1, filePath: 'a.ts' },
        { name: 'init', depth: 1, filePath: 'b.ts' },
        { name: 'setup', depth: 2, filePath: 'c.ts' },
      ],
    };
    const result = compressToolResponse('get_callers', data, { format: 'full' }) as any;
    expect(result._summary).toBeUndefined();
    expect(result.callers).toEqual(data.callers);
    expect(result._meta.compressed).toBe(false);
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

describe('compressToolResponse — never larger than the plain payload (M0-15)', () => {
  const tokens = (v: unknown) => Math.ceil(JSON.stringify(v).length / 4);
  const withoutMeta = (r: Record<string, unknown>) => {
    const { _meta: _ignored, ...rest } = r;
    return rest;
  };
  const pct = (r: { _meta: { reduction: string } }) => parseFloat(r._meta.reduction);

  it('returns the plain payload for a small get_callers response where _summary would add tokens', () => {
    const data = {
      symbol: 'GoFormatName',
      callers: [{ id: 'x', name: 'GoGreet', kind: 'function', filePath: 'go/greet.go', line: 15, depth: 1 }],
    };
    const result = compressToolResponse('get_callers', data);
    // The plain payload is labelled as the full format.
    expect(withoutMeta(result)).toEqual({ format: 'full', ...data });
    expect(result._summary).toBeUndefined();
    expect(result._meta.reduction).toBe('0.0%');
    expect(result._meta.compressed).toBe(false);
    expect(result._meta.layers).toEqual([]);
  });

  it('never reports negative reduction for a small get_context response with a tiny file baseline', () => {
    const data = {
      filePath: '/abs/path/to/project/go/main.go',
      startLine: 1,
      endLine: 7,
      content: 'package main\n\nfunc main() {}',
      language: 'go',
      totalLines: 7,
      symbolsInRange: [{ id: 'abc123', name: 'main', kind: 'function', startLine: 5, endLine: 7 }],
    };
    // The full (tiny) file baseline is smaller than the JSON envelope around it.
    const result = compressToolResponse('get_context', data, { originalTokens: 10 });
    expect(pct(result)).toBeGreaterThanOrEqual(0);
    expect(result._meta.compressedTokens).toBeLessThanOrEqual(result._meta.originalTokens);
  });

  it('keeps compression when it does reduce size and reports compressed: true', () => {
    const content = Array.from({ length: 40 }, (_, i) => `// comment line ${i}\n\nconst v${i} = ${i};   `).join('\n');
    const data = { filePath: 'a.ts', content, language: 'typescript' };
    const result = compressToolResponse('get_context', data);
    expect(result.content.length).toBeLessThan(content.length);
    expect(result._meta.compressed).toBe(true);
    expect(result._meta.layers).toContain('compact');
    expect(pct(result)).toBeGreaterThan(0);
  });

  it('never makes any tool response larger than the plain payload', () => {
    const listTools = new Set([
      'find_symbol', 'get_references', 'list_dependencies', 'get_file_structure', 'get_callers',
      'get_callees', 'impact_analysis',
    ]);
    const tools = [
      'find_symbol', 'get_references', 'list_dependencies', 'get_file_structure', 'get_callers',
      'get_callees', 'get_context', 'impact_analysis', 'semantic_search', 'find_pattern',
    ];
    const data = {
      symbols: [{ name: 'a', kind: 'function', signature: '' }],
      references: [{ filePath: 'a.ts', kind: 'calls', line: 1 }],
      dependencies: [{ target: 'x', kind: 'package' }],
      callers: [{ name: 'b', depth: 1, filePath: 'b.ts' }],
      content: 'x',
      totalCount: 1,
    };
    for (const tool of tools) {
      const result = compressToolResponse(tool, data);
      // List tools' plain payload is the full format, which carries `format: "full"`.
      const plain = listTools.has(tool) ? { format: 'full', ...data } : data;
      expect(tokens(withoutMeta(result)), tool).toBeLessThanOrEqual(tokens(plain));
      expect(pct(result), tool).toBeGreaterThanOrEqual(0);
    }
  });
});
