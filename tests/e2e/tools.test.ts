import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Project root (where src/index.ts lives)
const PROJECT_ROOT = resolve(__dirname, '..', '..');

// Fixture project to index
const PROJECT_DIR = resolve(PROJECT_ROOT, 'tests', 'fixtures', 'ts-basic');

// Data dir for the fixture index
const E2E_DATA_DIR = resolve(PROJECT_DIR, '.hesman-e2e');

describe('Hesman E2E — MCP tools via stdio', () => {
  let client: Client;
  let transport: StdioClientTransport;
  let tools: ListToolsResult['tools'];

  beforeAll(async () => {
    // Clean up any leftover data dir from previous runs
    if (existsSync(E2E_DATA_DIR)) {
      rmSync(E2E_DATA_DIR, { recursive: true });
    }

    // Start hesman as child process.
    // We run from the project root (so the server source is found) but set
    // HESMAN_PROJECT_ROOT so the server indexes the fixture project.
    transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/index.ts'],
      env: {
        ...process.env,
        HESMAN_LOG_LEVEL: 'error',
        HESMAN_DATA_DIR: '.hesman-e2e',
        HESMAN_PROJECT_ROOT: PROJECT_DIR,
      },
    });

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    // Wait for server startup — includes embedding model loading on first run
    // (Xenova/all-MiniLM-L6-v2 can take 10-30s to download + load)
    await new Promise((r) => setTimeout(r, 3000));

    // Use the high-level listTools() method instead of raw client.request
    const result = await client.listTools({}, { timeout: 5000 });
    tools = result.tools;
  }, 120000);

  afterAll(async () => {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
    // Clean up data dir
    if (existsSync(E2E_DATA_DIR)) {
      rmSync(E2E_DATA_DIR, { recursive: true });
    }
  });

  it('registers 11 tools (all Phase 1 through Phase 5 tools)', () => {
    const names = tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
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
    ]);
  }, 5000);

  it('find_symbol finds exported functions', async () => {
    const result = await client.callTool(
      { name: 'find_symbol', arguments: { name: 'add', matchMode: 'exact' } },
      undefined,
      { timeout: 5000 },
    );

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const data = JSON.parse(text);

    expect(data.symbols).toBeDefined();
    expect(data.symbols.length).toBeGreaterThan(0);
    const addSymbol: { name: string; kind: string; isExported: boolean } | undefined = data.symbols.find((s: { name: string }) => s.name === 'add');
    expect(addSymbol).toBeDefined();
    expect(addSymbol.kind).toBe('function');
    expect(addSymbol.isExported).toBe(true);
  });

  it('find_symbol returns empty for nonexistent symbol', async () => {
    const result = await client.callTool(
      { name: 'find_symbol', arguments: { name: 'nonexistentFunction' } },
      undefined,
      { timeout: 5000 },
    );

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const data = JSON.parse(text);
    expect(data.symbols).toHaveLength(0);
  });

  it('get_file_structure returns symbols in a file', async () => {
    const utilsPath = resolve(PROJECT_DIR, 'src/utils.ts');
    const result = await client.callTool(
      { name: 'get_file_structure', arguments: { filePath: utilsPath } },
      undefined,
      { timeout: 5000 },
    );

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const data = JSON.parse(text);

    expect(data.file).toBe(utilsPath);
    expect(data.language).toBe('typescript');
    expect(data.symbols.length).toBeGreaterThan(0);
    expect(data.totalSymbols).toBeGreaterThan(0);
  });

  it('index_status reports indexing info', async () => {
    const result = await client.callTool(
      { name: 'index_status', arguments: {} },
      undefined,
      { timeout: 5000 },
    );

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const data = JSON.parse(text);

    expect(data.totalFiles).toBeGreaterThan(0);
    expect(data.totalSymbols).toBeGreaterThan(0);
    expect(data.health.sqliteOk).toBe(true);
  });

  it('get_references returns references for a known symbol', async () => {
    // Use formatGreeting — it's called from main() in the same file,
    // so intra-file call relations should exist (cross-file resolution
    // is a Phase 4 feature).
    const findResult = await client.callTool(
      { name: 'find_symbol', arguments: { name: 'formatGreeting' } },
      undefined,
      { timeout: 5000 },
    );

    const findText = (findResult.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const findData = JSON.parse(findText);

    expect(findData.symbols.length).toBeGreaterThan(0);
    const symbolId = findData.symbols[0].id;

    // Now call get_references with that symbolId
    const refResult = await client.callTool(
      { name: 'get_references', arguments: { symbolId } },
      undefined,
      { timeout: 5000 },
    );

    const refText = (refResult.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const refData = JSON.parse(refText);

    expect(refData.references).toBeDefined();
    expect(refData.references.length).toBeGreaterThan(0);
    expect(refData.totalCount).toBeGreaterThan(0);

    // At least one reference should be a 'calls' kind (from main() calling add())
    const callRefs = refData.references.filter((r: { kind: string }) => r.kind === 'calls');
    expect(callRefs.length).toBeGreaterThan(0);

    // Verify reference shape
    const firstRef = refData.references[0];
    expect(firstRef).toHaveProperty('filePath');
    expect(firstRef).toHaveProperty('line');
    expect(firstRef).toHaveProperty('col');
    expect(firstRef).toHaveProperty('kind');
    expect(firstRef).toHaveProperty('callerSymbolId');
    expect(firstRef).toHaveProperty('callerName');
  }, 30000);

  it('semantic_search finds code by natural language', async () => {
    // Wait a moment for embedding model to load
    const result = await client.callTool(
      { name: 'semantic_search', arguments: { query: 'add two numbers', topK: 5 } },
      undefined,
      { timeout: 15000 },
    );

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const data = JSON.parse(text);

    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.embeddingTookMs).toBeGreaterThan(0);
    // The add function should rank highly for "add two numbers"
    const topNames = data.results.slice(0, 5).map((r: { name: string }) => r.name);
    expect(topNames).toContain('add');
  }, 30000);

  it('semantic_search respects topK', async () => {
    const result = await client.callTool(
      { name: 'semantic_search', arguments: { query: 'function', topK: 2 } },
      undefined,
      { timeout: 10000 },
    );

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const data = JSON.parse(text);

    expect(data.results.length).toBeLessThanOrEqual(2);
  });
});
