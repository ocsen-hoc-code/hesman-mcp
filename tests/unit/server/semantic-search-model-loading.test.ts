import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import type { ZVecStore } from '../../../src/stores/zvec.js';
import { registerSemanticSearchTool } from '../../../src/server/tools/semantic-search.js';
import { indexState } from '../../../src/indexing/index-state.js';
import { defaultConfig } from '../../../src/config/defaults.js';

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

/** The embedding model is never loaded in this file, so every search hits the not-ready branch. */
describe('semantic_search while the embedding model is not ready', () => {
  let handler: ToolHandler;
  let search: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const server = {
      registerTool(_name: string, _description: string, _schema: object, h: ToolHandler) {
        handler = h;
      },
    } as unknown as McpServer;
    search = vi.fn(() => []);
    registerSemanticSearchTool(server, { search } as unknown as ZVecStore, defaultConfig);
  });

  afterEach(() => indexState.reset());

  async function error(): Promise<{ code: string; message: string }> {
    const result = (await handler({ query: 'add numbers' })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
    return (JSON.parse(result.content[0].text ?? '{}') as { error: { code: string; message: string } }).error;
  }

  it('says the model is still loading during background startup', async () => {
    indexState.begin('loading-model');
    const err = await error();
    expect(err.code).toBe('INDEX_NOT_READY');
    expect(err.message).toMatch(/still loading/i);
    expect(err.message).toMatch(/index_status/);
  });

  it('reports why the model failed to load', async () => {
    indexState.begin('loading-model');
    indexState.setModelError(new Error('getaddrinfo ENOTFOUND huggingface.co'));
    indexState.update({ phase: 'scanning', filesDone: 0, filesTotal: 0 });
    const err = await error();
    expect(err.code).toBe('INDEX_NOT_READY');
    expect(err.message).toMatch(/failed to load/i);
    expect(err.message).toContain('ENOTFOUND huggingface.co');
  });

  it('keeps the generic message when no background load is involved', async () => {
    const err = await error();
    expect(err.code).toBe('INDEX_NOT_READY');
    expect(err.message).toMatch(/not loaded/i);
  });
});
