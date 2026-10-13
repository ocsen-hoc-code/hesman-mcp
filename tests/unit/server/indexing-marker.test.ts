import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compressToolResponse } from '../../../src/server/response-compressor.js';
import { indexState } from '../../../src/indexing/index-state.js';
import { registerIndexStatusTool } from '../../../src/server/tools/index-status.js';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import { SqliteStore } from '../../../src/stores/sqlite.js';

describe('indexing marker in tool responses', () => {
  afterEach(() => indexState.reset());

  it('omits _meta.indexing when no index run is in progress', () => {
    const result = compressToolResponse('find_symbol', { symbols: [], tookMs: 1 });
    expect(result._meta).toBeDefined();
    expect('indexing' in result._meta).toBe(false);
  });

  it('adds _meta.indexing with the current progress while indexing runs', () => {
    indexState.begin('scanning');
    indexState.update({ phase: 'indexing', filesDone: 12, filesTotal: 300 });
    const result = compressToolResponse('find_symbol', { symbols: [], tookMs: 1 });
    expect(result._meta.indexing).toEqual({ inProgress: true, filesDone: 12, filesTotal: 300 });
  });

  it('drops the marker again once the run completes', () => {
    indexState.begin('scanning');
    indexState.complete();
    const result = compressToolResponse('find_symbol', { symbols: [], tookMs: 1 });
    expect('indexing' in result._meta).toBe(false);
  });

  it('never adds _meta to index_status', () => {
    indexState.begin('scanning');
    const result = compressToolResponse('index_status', { totalFiles: 0 });
    expect(result).toEqual({ totalFiles: 0 });
  });
});

describe('index_status indexing block', () => {
  let dataDir: string;
  let store: SqliteStore;
  let handler: ToolHandler;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-index-status-'));
    store = new SqliteStore(dataDir);
    store.open();
    const server = {
      registerTool: (_name: string, _description: string, _schema: object, h: ToolHandler) => {
        handler = h;
      },
    } as unknown as McpServer;
    registerIndexStatusTool(server, store);
  });

  afterEach(() => {
    indexState.reset();
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  interface StatusBody {
    pendingFiles: number;
    indexing: Record<string, unknown>;
    health: Record<string, unknown>;
  }

  async function status(): Promise<StatusBody> {
    const result = await handler({});
    return JSON.parse(result.content[0].text ?? '{}') as StatusBody;
  }

  it('reports an idle index when no run has started', async () => {
    const body = await status();
    expect(body.indexing).toEqual({
      inProgress: false,
      phase: 'idle',
      filesDone: 0,
      filesTotal: 0,
      startedAt: null,
      error: null,
    });
    expect(body.pendingFiles).toBe(0);
    expect(body.health.embeddingModelError).toBeNull();
  });

  it('reports phase and file counts while indexing runs', async () => {
    indexState.begin('scanning', Date.UTC(2026, 9, 11));
    indexState.update({ phase: 'indexing', filesDone: 40, filesTotal: 100 });
    const body = await status();
    expect(body.indexing).toEqual({
      inProgress: true,
      phase: 'indexing',
      filesDone: 40,
      filesTotal: 100,
      startedAt: '2026-10-11T00:00:00.000Z',
      error: null,
    });
    expect(body.pendingFiles).toBe(60);
    // Existing fields stay in place.
    expect(body).toMatchObject({ totalFiles: 0, indexedFiles: 0, totalSymbols: 0, totalRelations: 0 });
  });

  it('surfaces background failures instead of hiding them', async () => {
    indexState.begin('loading-model');
    indexState.setModelError('model download failed');
    indexState.fail(new Error('scan exploded'));
    const body = await status();
    expect(body.indexing).toMatchObject({ inProgress: false, phase: 'failed', error: 'scan exploded' });
    expect(body.health.embeddingModelError).toBe('model download failed');
  });
});
