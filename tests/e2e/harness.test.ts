import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { DIST_ENTRY, parseJsonRpcLine, startServer, type HesmanTestServer } from './helpers/server.js';

interface FindSymbolResponse {
  symbols: Array<{ name: string; kind: string; filePath: string; isExported: boolean }>;
}

const ALL_TOOLS = [
  'find_pattern',
  'find_symbol',
  'get_callees',
  'get_callers',
  'get_context',
  'get_file_structure',
  'get_references',
  'impact_analysis',
  'index_status',
  'list_dependencies',
  'semantic_search',
];

describe('E2E harness — real server with semantic search enabled', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    // The semantic_search tool is registered whenever the vector store opens,
    // even if the embedding model cannot be loaded (e.g. offline).
    server = await startServer({ fixture: 'polyglot-basic', semantic: true, readyTimeoutMs: 110000 });
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it('lists all 11 tools', async () => {
    const { tools } = await server.client.listTools({}, { timeout: 10000 });
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
  });
});

describe('E2E harness — real server (dist/index.js) on polyglot-basic', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    server = await startServer({ fixture: 'polyglot-basic' });
  }, 120000);

  afterAll(async () => {
    const dataDir = server?.dataDir;
    await server?.stop();
    if (dataDir) expect(existsSync(dataDir)).toBe(false);
  });

  it('runs the built binary', () => {
    expect(existsSync(DIST_ENTRY)).toBe(true);
    expect(server.transport.pid).toBeTypeOf('number');
  });

  it('records raw stdout lines, including JSON-RPC responses', () => {
    expect(server.stdoutLines.length).toBeGreaterThan(0);
    expect(server.stdoutLines.some((line) => parseJsonRpcLine(line) !== null)).toBe(true);
  });

  it('lists every tool except semantic_search when started with --no-semantic', async () => {
    const { tools } = await server.client.listTools({}, { timeout: 10000 });
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS.filter((t) => t !== 'semantic_search'));
  });

  it('find_symbol finds a TypeScript symbol', async () => {
    const data = await server.callToolJson<FindSymbolResponse>('find_symbol', {
      name: 'tsGreet',
      matchMode: 'exact',
    });
    const symbol = data.symbols.find((s) => s.name === 'tsGreet');
    expect(symbol).toBeDefined();
    expect(symbol?.kind).toBe('function');
    expect(symbol?.isExported).toBe(true);
    expect(symbol?.filePath).toMatch(/greet\.ts$/);
  });
});
