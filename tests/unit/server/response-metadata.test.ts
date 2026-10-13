import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore, type SymbolRow } from '../../../src/stores/sqlite.js';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import { registerAllTools } from '../../../src/server/tools/index.js';
import { defaultConfig } from '../../../src/config/defaults.js';

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

function body(result: unknown): Record<string, unknown> {
  const r = result as ToolResult;
  expect(r.isError).toBeFalsy();
  return JSON.parse(r.content[0].text ?? '{}') as Record<string, unknown>;
}

describe('tool response metadata', () => {
  let root: string;
  let dataDir: string;
  let store: SqliteStore;
  let tools: Map<string, ToolHandler>;
  let symbolId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hesman-response-meta-'));
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-response-meta-data-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'trailing.ts'), 'const a = 1;\nconst b = 2;\n');
    writeFileSync(join(root, 'src', 'no-trailing.ts'), 'const a = 1;\nconst b = 2;');
    writeFileSync(join(root, 'src', 'empty.ts'), '');
    store = new SqliteStore(dataDir);
    store.open();
    symbolId = 'sym-alpha';
    const sym: SymbolRow = {
      id: symbolId,
      name: 'alpha',
      kind: 'function',
      file_path: join(root, 'src', 'trailing.ts'),
      start_line: 1,
      end_line: 1,
      start_col: 0,
      end_col: 12,
      signature: 'function alpha()',
      doc_comment: null,
      parent_id: null,
      language: 'typescript',
      is_exported: 1,
      updated_at: Date.now(),
    };
    store.upsertSymbols([sym]);
    tools = new Map<string, ToolHandler>();
    const server = {
      registerTool(name: string, _description: string, _inputSchema: object, handler: ToolHandler) {
        tools.set(name, handler);
      },
    } as unknown as McpServer;
    registerAllTools(server, store, undefined, { ...defaultConfig, projectRoot: root });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('get_context totalLines', () => {
    async function totalLines(file: string): Promise<unknown> {
      const result = await tools.get('get_context')!({ filePath: `src/${file}`, startLine: 1, mode: 'full' });
      return body(result).totalLines;
    }

    it('does not count the trailing newline as an extra line', async () => {
      expect(await totalLines('trailing.ts')).toBe(2);
    });

    it('counts the last line when the file has no trailing newline', async () => {
      expect(await totalLines('no-trailing.ts')).toBe(2);
    });

    it('reports 0 lines for an empty file', async () => {
      expect(await totalLines('empty.ts')).toBe(0);
    });
  });

  describe('tookMs is measured, not hard-coded', () => {
    beforeEach(() => {
      // Every clock read advances by 7.5 ms, so any measured duration is >= 7.5.
      let now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => (now += 7.5));
    });

    it.each([
      ['find_symbol', (): Record<string, unknown> => ({ name: 'alpha', matchMode: 'exact' })],
      ['get_file_structure', (): Record<string, unknown> => ({ filePath: 'src/trailing.ts' })],
      ['get_references', (): Record<string, unknown> => ({ symbolId: 'sym-alpha' })],
    ])('%s reports the elapsed time', async (tool, args) => {
      const result = await tools.get(tool)!(args());
      expect(body(result).tookMs).toBeGreaterThanOrEqual(7.5);
    });
  });
});
