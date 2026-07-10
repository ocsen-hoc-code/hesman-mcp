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

    // Wait for initial indexing to complete
    await new Promise((r) => setTimeout(r, 3000));

    // Use the high-level listTools() method instead of raw client.request
    const result = await client.listTools({}, { timeout: 5000 });
    tools = result.tools;
  }, 20000);

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

  it('registers 3 tools', () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['find_symbol', 'get_file_structure', 'index_status']);
  });

  it('find_symbol finds exported functions', async () => {
    const result = await client.callTool(
      { name: 'find_symbol', arguments: { name: 'add' } },
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
});
