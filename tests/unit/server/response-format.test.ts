import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { BENCH_FIXTURE, openBench, symbolIdOf, type Bench } from '../../perf/response-tokens.js';

/** The `format` argument of the list tools (M4-01): compact by default, `full` for the plain objects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool answers are untyped JSON
type Answer = Record<string, any>;

const LIST_TOOLS = [
  { tool: 'get_references', args: { symbol: 'hub' } },
  { tool: 'get_callers', args: { symbol: 'hub' } },
  { tool: 'get_callees', args: { symbol: 'runAll' } },
  { tool: 'find_symbol', args: { name: 'step', matchMode: 'prefix' } },
  { tool: 'get_file_structure', args: { filePath: 'src/features/large.ts' } },
  { tool: 'list_dependencies', args: { filePath: 'src/features/index.ts' } },
  { tool: 'impact_analysis', args: { symbol: 'hub', changeType: 'rename', newName: 'double' } },
] as const;

describe('list tool response formats (M4-01)', () => {
  let bench: Bench;
  let root: string;
  let hub: string;
  let registry: string;

  const call = async (tool: string, args: Record<string, unknown>): Promise<Answer> => {
    const result = (await bench.tools.get(tool)!(args)) as { content: Array<{ text?: string }>; isError?: boolean };
    return { ...JSON.parse(result.content[0].text ?? '{}'), _isError: result.isError === true };
  };
  const expectOk = (answer: Answer) => {
    expect(answer.error, JSON.stringify(answer.error)).toBeUndefined();
    expect(answer._isError).toBe(false);
    return answer;
  };
  /** The rows of a compact answer as objects keyed by its columns, with the file of each row. */
  const rowsOf = (answer: Answer): Array<Record<string, unknown>> => {
    const columns: string[] = answer.columns;
    const groups: Array<{ file?: string; rows: unknown[][] }> = answer.files ?? [{ file: answer.file, rows: answer.rows }];
    return groups.flatMap((g) =>
      g.rows.map((row) => ({ ...Object.fromEntries(columns.map((c, i) => [c, row[i]])), ...(g.file !== undefined ? { _file: g.file } : {}) })),
    );
  };

  beforeAll(async () => {
    bench = await openBench(BENCH_FIXTURE);
    root = BENCH_FIXTURE;
    hub = symbolIdOf(bench, 'hub');
    registry = symbolIdOf(bench, 'Registry');
  });

  afterAll(() => bench.close());

  describe('default (compact) shape', () => {
    it('get_references groups rows by file, with named columns, relative paths and a format label', async () => {
      const answer = expectOk(await call('get_references', { symbolId: hub, topK: 200 }));
      expect(answer.format).toBe('compact');
      expect(answer.columns).toEqual(['line', 'col', 'kind', 'callerSymbolId', 'callerName']);
      expect(answer.references).toBeUndefined();
      expect(answer.totalCount).toBe(70);
      const rows = rowsOf(answer);
      expect(rows).toHaveLength(70);
      for (const groupFile of answer.files.map((f: { file: string }) => f.file)) {
        expect(groupFile.startsWith('src/')).toBe(true);
        expect(groupFile.startsWith('/')).toBe(false);
      }
      expect(answer.files.every((f: { rows: unknown[][] }) => f.rows.every((r) => r.length === answer.columns.length))).toBe(true);
      expect(answer._meta.compressed).toBe(true);
      expect(answer._meta.layers).toEqual(['group', 'columns', 'paths']);
    });

    it('get_callers puts the call-site file only where the call is in another file (callFile)', async () => {
      const answer = expectOk(await call('get_callers', { symbolId: hub, maxDepth: 2, topK: 200 }));
      expect(answer.columns).toEqual(['symbolId', 'name', 'kind', 'line', 'depth', 'callLine', 'callFile']);
      const rows = rowsOf(answer);
      const direct = rows.filter((r) => r.depth === 1);
      expect(direct.length).toBeGreaterThan(0);
      expect(direct.every((r) => r.callFile === null)).toBe(true);
      // The call sites of this fixture's depth-2 chain are in the caller's own file (runAll in index.ts).
      const transitive = rows.filter((r) => r.depth === 2);
      expect(transitive.length).toBeGreaterThan(0);
      expect(transitive.every((r) => r.callFile === null)).toBe(true);
    });

    it('get_callees and find_symbol keep one row per entry in their group', async () => {
      const callees = expectOk(await call('get_callees', { symbolId: symbolIdOf(bench, 'runAll'), topK: 200 }));
      expect(rowsOf(callees)).toHaveLength(10);
      const symbols = expectOk(await call('find_symbol', { name: 'step', matchMode: 'prefix', topK: 50 }));
      expect(rowsOf(symbols)).toHaveLength(20);
      expect(symbols.columns).toContain('signature');
      expect(symbols.columns).not.toContain('parentName');
    });

    it('get_file_structure writes nested symbols as rows with a parentId', async () => {
      const answer = expectOk(await call('get_file_structure', { filePath: 'src/core/hub.ts' }));
      expect(answer.format).toBe('compact');
      expect(answer.file).toBe('src/core/hub.ts');
      expect(answer.columns).toEqual(['id', 'name', 'kind', 'line', 'endLine', 'signature', 'isExported', 'parentId']);
      const rows = rowsOf(answer);
      const register = rows.find((r) => r.name === 'register');
      expect(register?.parentId).toBe(registry);
      expect(rows.find((r) => r.name === 'hub')?.parentId).toBeNull();
    });

    it('list_dependencies returns one row per dependency under named columns', async () => {
      const answer = expectOk(await call('list_dependencies', { filePath: 'src/features/index.ts' }));
      expect(answer.format).toBe('compact');
      expect(answer.columns).toEqual(['target', 'kind', 'importedSymbols', 'count']);
      expect(answer.rows).toHaveLength(10);
      expect(answer.file).toBe('src/features/index.ts');
    });

    it('impact_analysis groups locations by file and keeps the symbol info', async () => {
      const answer = expectOk(await call('impact_analysis', { symbolId: hub, changeType: 'rename', newName: 'double', maxFiles: 50 }));
      expect(answer.format).toBe('compact');
      expect(answer.columns).toEqual(['line', 'col', 'kind', 'action', 'currentCode']);
      expect(answer.impactedFiles).toBeUndefined();
      expect(answer.symbol.filePath).toBe('src/core/hub.ts');
      expect(answer.files.every((f: { severity: string }) => typeof f.severity === 'string')).toBe(true);
      expect(answer.files.every((f: { reasons?: unknown }) => f.reasons === undefined)).toBe(true);
    });

    it('a compact value can be passed back to the other tools unchanged', async () => {
      const refs = expectOk(await call('get_references', { symbolId: hub, topK: 5 }));
      const [first] = rowsOf(refs);
      // The file of a row is accepted as a relative filePath, the caller id as a symbolId.
      const structure = expectOk(await call('get_file_structure', { filePath: first._file as string }));
      expect(structure.symbols ?? structure.rows).toBeDefined();
      const callers = expectOk(await call('get_callers', { symbolId: first.callerSymbolId as string }));
      expect(callers.format).toBe('compact');
      const context = expectOk(await call('get_context', { filePath: first._file as string, startLine: first.line as number }));
      expect(context.content).toBeDefined();
    });

    it('a list too small to shrink is returned in the full format', async () => {
      const answer = expectOk(await call('get_callers', { symbolId: symbolIdOf(bench, 'reportFeature1') }));
      expect(answer.format).toBe('full');
      expect(answer.callers).toEqual([]);
      expect(answer._meta.compressed).toBe(false);
      expect(answer._meta.reduction).toBe('0.0%');
    });
  });

  describe('format: "full"', () => {
    it.each(LIST_TOOLS)('$tool returns the plain objects with absolute paths', async ({ tool, args }) => {
      const resolved = await resolveArgs(args);
      const answer = expectOk(await call(tool, { ...resolved, format: 'full' }));
      expect(answer.format).toBe('full');
      expect(answer.columns).toBeUndefined();
      expect(answer._meta.compressed).toBe(false);
      expect(JSON.stringify(answer)).not.toContain('"rows"');
      const plainPaths = JSON.stringify(answer).match(/"filePath":"([^"]+)"/g) ?? [];
      for (const entry of plainPaths) expect(entry.includes(root)).toBe(true);
    });

    it('get_references full keeps one object per reference', async () => {
      const answer = expectOk(await call('get_references', { symbolId: hub, topK: 200, format: 'full' }));
      expect(answer.references).toHaveLength(70);
      expect(answer.references[0]).toMatchObject({ kind: 'calls', col: expect.any(Number) });
      expect(answer.references[0].filePath.startsWith(join(root, 'src'))).toBe(true);
      expect(answer.references[0]).not.toHaveProperty('context');
    });
  });

  describe('argument validation', () => {
    it.each(LIST_TOOLS)('$tool rejects an unknown format with INVALID_INPUT', async ({ tool, args }) => {
      const resolved = await resolveArgs(args);
      const answer = await call(tool, { ...resolved, format: 'summary' });
      expect(answer._isError).toBe(true);
      expect(answer.error.code).toBe('INVALID_INPUT');
      expect(answer.error.message).toContain('format');
    });
  });

  describe('paging', () => {
    it('get_references pages through every reference with the cursor in the compact shape', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const answer = expectOk(await call('get_references', { symbolId: hub, topK: 25, ...(cursor ? { cursor } : {}) }));
        expect(answer.format).toBe('compact');
        for (const r of rowsOf(answer)) seen.push(`${r._file}:${r.line}:${r.col}`);
        if (!answer.hasMore) break;
        cursor = answer.nextCursor;
      }
      expect(seen).toHaveLength(70);
      expect(new Set(seen).size).toBe(70);
    });
  });

  describe('responses without a list', () => {
    it('get_context and index_status keep their shape', async () => {
      const context = expectOk(await call('get_context', { filePath: 'src/features/feature-1.ts', startLine: 3, endLine: 12, contextLines: 2 }));
      expect(context.format).toBeUndefined();
      expect(context.content).toBeDefined();
      const status = expectOk(await call('index_status', {}));
      expect(status.format).toBeUndefined();
    });
  });

  /** Replace `symbol` (a name) with its id, leave other arguments alone. */
  async function resolveArgs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { symbol, ...rest } = args as { symbol?: string } & Record<string, unknown>;
    return symbol ? { ...rest, symbolId: symbolIdOf(bench, symbol) } : rest;
  }
});

describe('compact call rows and the project root (M4-01)', () => {
  it('writes the call-site file of a call made in another file, relative to the root', async () => {
    const { compressToolResponse } = await import('../../../src/server/response-compressor.js');
    const root = '/work/project';
    const answer = compressToolResponse(
      'get_callers',
      {
        callers: [
          {
            symbolId: 'a1',
            name: 'outer',
            kind: 'function',
            filePath: `${root}/src/outer.ts`,
            startLine: 3,
            depth: 2,
            callSite: { filePath: `${root}/src/middle.ts`, line: 9 },
          },
          {
            symbolId: 'b2',
            name: 'middle',
            kind: 'function',
            filePath: `${root}/src/middle.ts`,
            startLine: 1,
            depth: 1,
            callSite: { filePath: `${root}/src/middle.ts`, line: 2 },
          },
        ],
        tookMs: 1,
      },
      { format: 'compact', projectRoot: root },
    );
    expect(answer.format).toBe('compact');
    expect(answer.columns).toEqual(['symbolId', 'name', 'kind', 'line', 'depth', 'callLine', 'callFile']);
    expect(answer.files).toEqual([
      { file: 'src/outer.ts', rows: [['a1', 'outer', 'function', 3, 2, 9, 'src/middle.ts']] },
      { file: 'src/middle.ts', rows: [['b2', 'middle', 'function', 1, 1, 2, null]] },
    ]);
  });

  it('keeps absolute paths when no project root is given', async () => {
    const { compressToolResponse } = await import('../../../src/server/response-compressor.js');
    const answer = compressToolResponse(
      'get_references',
      {
        references: Array.from({ length: 12 }, (_, i) => ({
          filePath: `/work/project/src/file-${i % 3}.ts`,
          line: i + 1,
          col: 1,
          kind: 'calls',
          callerSymbolId: `c${i}`,
          callerName: `caller${i}`,
        })),
        totalCount: 12,
      },
      { format: 'compact' },
    );
    expect(answer.format).toBe('compact');
    expect(answer.files.map((f: { file: string }) => f.file)).toEqual([
      '/work/project/src/file-0.ts',
      '/work/project/src/file-1.ts',
      '/work/project/src/file-2.ts',
    ]);
    expect(answer._meta.layers).not.toContain('paths');
  });
});
