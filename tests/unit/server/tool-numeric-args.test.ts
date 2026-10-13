import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore, type SymbolRow } from '../../../src/stores/sqlite.js';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import type { ZVecStore } from '../../../src/stores/zvec.js';
import { registerAllTools } from '../../../src/server/tools/index.js';
import { defaultConfig } from '../../../src/config/defaults.js';

interface CapturedTool {
  inputSchema: { properties?: Record<string, Record<string, unknown>> };
  handler: ToolHandler;
}

function makeFakeServer(): { server: McpServer; tools: Map<string, CapturedTool> } {
  const tools = new Map<string, CapturedTool>();
  const server = {
    registerTool(name: string, _description: string, inputSchema: object, handler: ToolHandler) {
      tools.set(name, { inputSchema: inputSchema as CapturedTool['inputSchema'], handler });
    },
  } as unknown as McpServer;
  return { server, tools };
}

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

interface ParsedBody {
  error: { code: string; message: string };
  symbols: unknown[];
  startLine: number;
  endLine: number;
}

function parse(result: unknown): ParsedBody {
  return JSON.parse((result as ToolResult).content[0].text ?? '{}') as ParsedBody;
}

const makeSymbol = (i: number): SymbolRow => ({
  id: `dup-${i}`,
  name: 'dup',
  kind: 'function',
  file_path: `src/f${i}.ts`,
  start_line: 1,
  end_line: 2,
  start_col: 0,
  end_col: 1,
  signature: 'function dup(): void',
  doc_comment: null,
  parent_id: null,
  language: 'typescript',
  is_exported: 1,
  updated_at: Date.now(),
});

describe('tool numeric arguments', () => {
  let dir: string;
  let store: SqliteStore;
  let tools: Map<string, CapturedTool>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-numeric-args-'));
    store = new SqliteStore(dir);
    store.open();
    const fake = makeFakeServer();
    tools = fake.tools;
    registerAllTools(fake.server, store, {} as ZVecStore, { ...defaultConfig, projectRoot: dir });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('find_symbol with topK: -1 returns no more than the maximum (200)', async () => {
    store.upsertSymbols(Array.from({ length: 250 }, (_, i) => makeSymbol(i)));
    const spy = vi.spyOn(store, 'getSymbolsByName');

    const result = await tools.get('find_symbol')!.handler({
      name: 'dup',
      matchMode: 'exact',
      topK: -1,
    });

    expect((result as ToolResult).isError).toBeFalsy();
    const limit = spy.mock.calls[0][3] as number;
    expect(limit).toBeGreaterThanOrEqual(1);
    expect(limit).toBeLessThanOrEqual(200);
    expect(parse(result).symbols.length).toBeLessThanOrEqual(200);
  });

  it('find_symbol with a huge topK is clamped to 200', async () => {
    store.upsertSymbols(Array.from({ length: 250 }, (_, i) => makeSymbol(i)));
    const spy = vi.spyOn(store, 'getSymbolsByName');
    await tools.get('find_symbol')!.handler({ name: 'dup', matchMode: 'exact', topK: 1e9 });
    expect(spy.mock.calls[0][3]).toBe(200);
  });

  it('find_symbol with a string topK returns INVALID_INPUT', async () => {
    const result = await tools.get('find_symbol')!.handler({ name: 'dup', topK: '10' });
    expect((result as ToolResult).isError).toBe(true);
    expect(parse(result).error.code).toBe('INVALID_INPUT');
  });

  it('get_callers clamps topK and maxDepth before hitting the store', async () => {
    const spy = vi.spyOn(store, 'getCallers');
    await tools.get('get_callers')!.handler({ symbolId: 'x', topK: -1, maxDepth: 99 });
    expect(spy).toHaveBeenCalledWith('x', 3, 1);
  });

  it('get_callees rejects a float maxDepth', async () => {
    const result = await tools.get('get_callees')!.handler({ symbolId: 'x', maxDepth: 1.5 });
    expect((result as ToolResult).isError).toBe(true);
    expect(parse(result).error.code).toBe('INVALID_INPUT');
  });

  it('get_context rejects NaN startLine and clamps contextLines', async () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, Array.from({ length: 50 }, (_, i) => `const v${i} = ${i};`).join('\n'));

    const bad = await tools.get('get_context')!.handler({ filePath: file, startLine: NaN });
    expect((bad as ToolResult).isError).toBe(true);
    expect(parse(bad).error.code).toBe('INVALID_INPUT');

    const ok = await tools.get('get_context')!.handler({
      filePath: file,
      startLine: 25,
      contextLines: -10,
      mode: 'full',
    });
    const body = parse(ok);
    expect(body.startLine).toBe(25);
    expect(body.endLine).toBe(25);
  });

  it('every numeric inputSchema property declares minimum and maximum', () => {
    let checked = 0;
    for (const [name, tool] of tools) {
      for (const [prop, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        if (schema.type !== 'number' && schema.type !== 'integer') continue;
        checked++;
        expect(schema.minimum, `${name}.${prop} minimum`).toBeTypeOf('number');
        expect(schema.maximum, `${name}.${prop} maximum`).toBeTypeOf('number');
      }
    }
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});
