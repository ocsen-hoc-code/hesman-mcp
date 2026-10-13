import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';
import { waitForIndexReady } from './helpers/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Project root (where src/index.ts lives)
const PROJECT_ROOT = resolve(__dirname, '..', '..');

// Fixture project to index
const PROJECT_DIR = resolve(PROJECT_ROOT, 'tests', 'fixtures', 'ts-basic');

// Data dir for the fixture index
const E2E_DATA_DIR = resolve(PROJECT_DIR, '.hesman-phase5-e2e');

describe('Hesman E2E — Phase 5 tools (get_context, impact_analysis)', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Clean up any leftover data dir from previous runs
    if (existsSync(E2E_DATA_DIR)) {
      rmSync(E2E_DATA_DIR, { recursive: true });
    }

    transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', 'src/index.ts'],
      env: {
        ...process.env,
        HESMAN_LOG_LEVEL: 'error',
        HESMAN_DATA_DIR: '.hesman-phase5-e2e',
        HESMAN_PROJECT_ROOT: PROJECT_DIR,
      },
    });

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    // The server indexes in the background: wait for the index, not a fixed delay.
    await waitForIndexReady(client);
  }, 120000);

  afterAll(async () => {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
    if (existsSync(E2E_DATA_DIR)) {
      rmSync(E2E_DATA_DIR, { recursive: true });
    }
  });

  describe('get_context', () => {
    const utilsPath = resolve(PROJECT_DIR, 'src/utils.ts');

    it('returns code context around a known location', async () => {
      const result = await client.callTool(
        { name: 'get_context', arguments: { filePath: utilsPath, startLine: 1, endLine: 5 } },
        undefined,
        { timeout: 10000 },
      );

      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      const data = JSON.parse(text);

      expect(data.filePath).toBe(utilsPath);
      expect(data.language).toBe('typescript');
      expect(data.totalLines).toBeGreaterThan(0);
      expect(data.content).toBeDefined();
      expect(data.content.length).toBeGreaterThan(0);
      expect(data.symbolsInRange).toBeDefined();
    }, 15000);

    it('returns error for nonexistent file', async () => {
      const result = await client.callTool(
        { name: 'get_context', arguments: { filePath: resolve(PROJECT_DIR, 'nonexistent/path.ts'), startLine: 1 } },
        undefined,
        { timeout: 5000 },
      );

      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      const data = JSON.parse(text);

      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('FILE_NOT_FOUND');
    }, 10000);
  });

  describe('impact_analysis', () => {
    let addSymbolId: string;

    beforeAll(async () => {
      // Find the 'add' function symbol to use as target
      const findResult = await client.callTool(
        { name: 'find_symbol', arguments: { format: 'full', name: 'add', matchMode: 'exact' } },
        undefined,
        { timeout: 5000 },
      );

      const findText = (findResult.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      const findData = JSON.parse(findText);
      expect(findData.symbols.length).toBeGreaterThan(0);
      addSymbolId = findData.symbols[0].id;
    }, 15000);

    it('returns impact analysis for a known symbol (rename)', async () => {
      const result = await client.callTool(
        {
          name: 'impact_analysis',
          arguments: {
            format: 'full',
            symbolId: addSymbolId,
            changeType: 'rename',
            newName: 'addition',
          },
        },
        undefined,
        { timeout: 10000 },
      );

      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      const data = JSON.parse(text);

      expect(data.symbol).toBeDefined();
      expect(data.symbol.id).toBe(addSymbolId);
      expect(data.symbol.name).toBe('add');
      expect(data.changeType).toBe('rename');
      expect(data._summary).toBeDefined();
      expect(data._summary.estimatedChanges).toBeGreaterThanOrEqual(0);
      expect(data.impactedFiles).toBeDefined();
    }, 15000);

    it('returns error for nonexistent symbolId', async () => {
      const result = await client.callTool(
        {
          name: 'impact_analysis',
          arguments: {
            format: 'full',
            symbolId: 'nonexistent-symbol-id',
            changeType: 'delete',
          },
        },
        undefined,
        { timeout: 5000 },
      );

      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      const data = JSON.parse(text);

      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('SYMBOL_NOT_FOUND');
    }, 10000);

    it('supports all change types', async () => {
      for (const changeType of ['rename', 'change_signature', 'delete', 'change_return_type']) {
        const result = await client.callTool(
          {
            name: 'impact_analysis',
            arguments: {
              format: 'full',
              symbolId: addSymbolId,
              changeType,
            },
          },
          undefined,
          { timeout: 10000 },
        );

        const text = (result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        const data = JSON.parse(text);

        expect(data.symbol).toBeDefined();
        expect(data.changeType).toBe(changeType);
        expect(data.impactedFiles).toBeDefined();
      }
    }, 30000);
  });
});
