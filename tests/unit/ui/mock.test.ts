import { describe, expect, it } from 'vitest';
import { ApiError, createApi } from '../../../src/ui/public/js/api.js';
import { createMockFetch } from '../../../src/ui/public/js/mock/mock-server.js';
import { buildFormModel } from '../../../src/ui/public/js/lib/schema-form.js';
import { emptyGraph, mergeNeighborhood } from '../../../src/ui/public/js/lib/graph-model.js';

const NOW = Date.UTC(2026, 9, 12, 9, 30);
const mockApi = (scenario = 'ready') =>
  createApi({ fetchImpl: createMockFetch({ scenario, now: () => NOW, delayMs: 0 }), token: 'mock' });

const keys = (o: object) => Object.keys(o).sort();

describe('mock backend: contract shapes', () => {
  it('GET /api/status', async () => {
    const s = await mockApi().status();
    expect(keys(s)).toEqual(['dataDir', 'index', 'projectRoot', 'serverTime', 'version']);
    expect(keys(s.index)).toEqual(
      expect.arrayContaining(['totalFiles', 'totalSymbols', 'totalRelations', 'indexing', 'health', 'languages', 'textTier']),
    );
    expect(s.index.indexing).toMatchObject({ inProgress: false, phase: 'ready' });
    expect(keys(s.index.languages[0])).toEqual(['files', 'language', 'symbols']);
    expect(keys(s.index.textTier)).toEqual(['chunks', 'files', 'languages']);
    expect(keys(s.index.health)).toEqual(['embeddingModelError', 'embeddingModelLoaded', 'sqliteOk', 'zvecDocCount', 'zvecOk']);
  });

  it('reports progress in the indexing scenario', async () => {
    const s = await mockApi('indexing').status();
    expect(s.index.indexing.inProgress).toBe(true);
    expect(s.index.indexing.filesTotal).toBeGreaterThan(0);
    expect(s.index.pendingFiles).toBe(s.index.indexing.filesTotal - s.index.indexing.filesDone);
  });

  it('GET /api/metrics', async () => {
    const m = await mockApi().metrics(60);
    expect(keys(m)).toEqual(['byTool', 'series', 'summary']);
    expect(keys(m.summary)).toEqual(['calls', 'errors', 'p50Ms', 'p95Ms', 'tokensOriginal', 'tokensReturned']);
    expect(keys(m.byTool[0])).toEqual(['avgMs', 'calls', 'errors', 'p95Ms', 'tokensOriginal', 'tokensReturned', 'tool']);
    expect(keys(m.series[0])).toEqual(['avgMs', 'calls', 'errors', 't']);
    expect(m.byTool.reduce((n: number, t: { calls: number }) => n + t.calls, 0)).toBe(m.summary.calls);
    expect(m.summary.tokensReturned).toBeLessThanOrEqual(m.summary.tokensOriginal);
  });

  it('GET /api/calls pages with nextBefore and filters by tool', async () => {
    const api = mockApi();
    const first = await api.calls({ limit: 10 });
    expect(first.calls).toHaveLength(10);
    expect(keys(first.calls[0])).toEqual([
      'argsPreview', 'compressedTokens', 'durationMs', 'errorCode', 'id', 'ok', 'originalTokens', 'time', 'tool',
    ]);
    const second = await api.calls({ limit: 10, before: first.nextBefore });
    expect(second.calls[0].id).not.toBe(first.calls[0].id);
    expect(new Set([...first.calls, ...second.calls].map((c: { id: string }) => c.id)).size).toBe(20);
    const filtered = await api.calls({ limit: 50, tool: 'get_context' });
    expect(filtered.calls.length).toBeGreaterThan(0);
    expect(filtered.calls.every((c: { tool: string }) => c.tool === 'get_context')).toBe(true);
  });

  it('GET /api/logs is newest first and filters by level and text', async () => {
    const api = mockApi();
    const all = await api.logs({ level: 'debug', limit: 200 });
    expect(keys(all.entries[0])).toEqual(['fields', 'level', 'msg', 'name', 'time']);
    const times = all.entries.map((e: { time: string }) => Date.parse(e.time));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const warn = await api.logs({ level: 'warn', limit: 200 });
    expect(warn.entries.length).toBeGreaterThan(0);
    expect(warn.entries.every((e: { level: string }) => e.level === 'warn' || e.level === 'error')).toBe(true);
    const text = await api.logs({ level: 'debug', q: 'watcher', limit: 200 });
    expect(text.entries.length).toBeGreaterThan(0);
    expect(text.entries.length).toBeLessThan(all.entries.length);
  });

  it('GET /api/graph/search', async () => {
    const api = mockApi();
    const { symbols } = await api.graphSearch({ q: 'cart', limit: 30 });
    expect(symbols.length).toBeGreaterThan(0);
    expect(keys(symbols[0])).toEqual(['endLine', 'filePath', 'id', 'isExported', 'kind', 'language', 'name', 'startLine']);
    expect(symbols[0].filePath.startsWith('/')).toBe(false);
    const classes = await api.graphSearch({ q: '', kind: 'class', limit: 30 });
    expect(classes.symbols.every((s: { kind: string }) => s.kind === 'class')).toBe(true);
    expect((await api.graphSearch({ q: 'zzzzqqq' })).symbols).toEqual([]);
  });

  it('GET /api/graph/neighborhood returns a mergeable graph and truncates at the limit', async () => {
    const api = mockApi();
    const { symbols } = await api.graphSearch({ q: 'checkout', limit: 5 });
    const hood = await api.neighborhood({ symbolId: symbols[0].id, depth: 1, limit: 80 });
    expect(keys(hood)).toEqual(['center', 'edges', 'nodes', 'truncated']);
    expect(keys(hood.edges[0])).toEqual(['from', 'kind', 'line', 'to']);
    const graph = mergeNeighborhood(emptyGraph(), hood);
    expect(graph.edges.length).toBe(new Set(hood.edges.map((e: { from: string; to: string; kind: string }) => `${e.from}|${e.to}|${e.kind}`)).size);
    const small = await api.neighborhood({ symbolId: symbols[0].id, depth: 2, limit: 3 });
    expect(small.nodes.length).toBeLessThanOrEqual(3);
    expect(small.truncated).toBe(true);
  });

  it('has a hub symbol with about 100 neighbors for the legibility check', async () => {
    const api = mockApi();
    const { symbols } = await api.graphSearch({ q: 'logEvent', limit: 5 });
    const hood = await api.neighborhood({ symbolId: symbols[0].id, depth: 1, limit: 120 });
    expect(hood.nodes.length).toBeGreaterThanOrEqual(90);
  });

  it('answers 404 for an unknown symbol', async () => {
    await expect(mockApi().neighborhood({ symbolId: 'nope' })).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('GET /api/graph/files', async () => {
    const f = await mockApi().files({ limit: 200 });
    expect(keys(f)).toEqual(['edges', 'nodes', 'truncated']);
    expect(keys(f.nodes[0])).toEqual(['id', 'language', 'symbols']);
    expect(keys(f.edges[0])).toEqual(['count', 'from', 'to']);
    const limited = await mockApi().files({ limit: 5 });
    expect(limited.nodes).toHaveLength(5);
    expect(limited.truncated).toBe(true);
  });
});

describe('mock backend: tools', () => {
  it('lists the 11 tools with usable schemas', async () => {
    const { tools } = await mockApi().tools();
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'find_pattern', 'find_symbol', 'get_callees', 'get_callers', 'get_context', 'get_file_structure',
      'get_references', 'impact_analysis', 'index_status', 'list_dependencies', 'semantic_search',
    ]);
    for (const tool of tools) {
      expect(typeof tool.description).toBe('string');
      expect(() => buildFormModel(tool.inputSchema)).not.toThrow();
    }
  });

  it('runs every listed tool', async () => {
    const api = mockApi();
    const { tools } = await api.tools();
    const { symbols } = await api.graphSearch({ q: 'checkout', limit: 1 });
    const sample: Record<string, unknown> = {
      name: 'cart', query: 'apply a discount', symbolId: symbols[0].id, filePath: symbols[0].filePath,
      startLine: 3, pattern: 'console.$M($$$A)', language: 'typescript', changeType: 'rename',
    };
    for (const tool of tools) {
      const args: Record<string, unknown> = {};
      for (const field of tool.inputSchema.required ?? []) args[field] = sample[field];
      const run = await api.runTool(tool.name, args);
      expect(run.isError, `${tool.name}: ${JSON.stringify(run.result)}`).toBe(false);
      expect(typeof run.durationMs).toBe('number');
      if (tool.name !== 'index_status') {
        expect(run.result._meta.originalTokens).toBeGreaterThanOrEqual(run.result._meta.compressedTokens);
      }
    }
  });

  it('returns a tool error for a missing required argument', async () => {
    const run = await mockApi().runTool('find_symbol', {});
    expect(run.isError).toBe(true);
    expect(run.result.error.code).toBe('INVALID_INPUT');
  });

  it('answers 404 for an unknown tool', async () => {
    await expect(mockApi().runTool('nope', {})).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('mock backend: failure scenarios', () => {
  it('unauthorized answers 401 everywhere', async () => {
    await expect(mockApi('unauthorized').status()).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
    await expect(mockApi('unauthorized').tools()).rejects.toBeInstanceOf(ApiError);
  });

  it('forbidden answers 403', async () => {
    await expect(mockApi('forbidden').status()).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('offline behaves like a stopped server', async () => {
    await expect(mockApi('offline').status()).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('empty has a project but nothing indexed or recorded', async () => {
    const api = mockApi('empty');
    expect((await api.status()).index.totalSymbols).toBe(0);
    expect((await api.metrics(60)).summary.calls).toBe(0);
    expect((await api.calls({})).calls).toEqual([]);
    expect((await api.logs({})).entries).toEqual([]);
    expect((await api.graphSearch({ q: 'a' })).symbols).toEqual([]);
    expect((await api.files({})).nodes).toEqual([]);
  });
});
