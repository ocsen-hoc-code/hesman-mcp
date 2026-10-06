import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore, type SymbolRow } from '../../../src/stores/sqlite.js';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import { registerAllTools } from '../../../src/server/tools/index.js';
import { defaultConfig } from '../../../src/config/defaults.js';

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

function makeFakeServer(): { server: McpServer; tools: Map<string, ToolHandler> } {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _description: string, _inputSchema: object, handler: ToolHandler) {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

interface ParsedBody {
  error: { code: string };
  content: string;
  symbols: unknown[];
}

function parse(result: unknown): ParsedBody {
  return JSON.parse((result as ToolResult).content[0].text ?? '{}') as ParsedBody;
}

const isWindows = process.platform === 'win32';

describe('tool path containment', () => {
  let root: string;
  let outside: string;
  let store: SqliteStore;
  let dataDir: string;
  let tools: Map<string, ToolHandler>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hesman-tool-paths-'));
    outside = mkdtempSync(join(tmpdir(), 'hesman-tool-paths-outside-'));
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-tool-paths-data-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'export function alpha() {}\n');
    writeFileSync(join(outside, 'secret.txt'), 'top secret\n');
    store = new SqliteStore(dataDir);
    store.open();
    const sym: SymbolRow = {
      id: 'alpha-1',
      name: 'alpha',
      kind: 'function',
      file_path: join(root, 'src', 'a.ts'),
      start_line: 1,
      end_line: 1,
      start_col: 0,
      end_col: 26,
      signature: 'function alpha()',
      doc_comment: null,
      parent_id: null,
      language: 'typescript',
      is_exported: 1,
      updated_at: Date.now(),
    };
    store.upsertSymbols([sym]);
    const fake = makeFakeServer();
    tools = fake.tools;
    registerAllTools(fake.server, store, undefined, { ...defaultConfig, projectRoot: root });
  });

  afterEach(() => {
    store.close();
    for (const d of [root, outside, dataDir]) rmSync(d, { recursive: true, force: true });
  });

  it('get_context rejects a path outside the project root', async () => {
    const result = await tools.get('get_context')!({ filePath: join(outside, 'secret.txt'), startLine: 1 });
    expect((result as ToolResult).isError).toBe(true);
    expect(parse(result).error.code).toBe('PATH_OUTSIDE_PROJECT');
    expect(JSON.stringify(result)).not.toContain('top secret');
  });

  it('get_context rejects a relative escape', async () => {
    const result = await tools.get('get_context')!({ filePath: '../../../../../../etc/passwd', startLine: 1 });
    expect((result as ToolResult).isError).toBe(true);
    expect(parse(result).error.code).toBe('PATH_OUTSIDE_PROJECT');
  });

  it.skipIf(isWindows)('get_context rejects an in-root symlink pointing outside', async () => {
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.ts'));
    const result = await tools.get('get_context')!({ filePath: 'leak.ts', startLine: 1 });
    expect((result as ToolResult).isError).toBe(true);
    expect(parse(result).error.code).toBe('PATH_OUTSIDE_PROJECT');
    expect(JSON.stringify(result)).not.toContain('top secret');
  });

  it('get_context rejects a directory', async () => {
    const result = await tools.get('get_context')!({ filePath: 'src', startLine: 1 });
    expect((result as ToolResult).isError).toBe(true);
    expect(parse(result).error.code).toBe('INVALID_INPUT');
  });

  it('get_context reports a missing in-root file as FILE_NOT_FOUND', async () => {
    const result = await tools.get('get_context')!({ filePath: 'src/missing.ts', startLine: 1 });
    expect((result as ToolResult).isError).toBe(true);
    expect(parse(result).error.code).toBe('FILE_NOT_FOUND');
  });

  it('get_context accepts a relative path and finds its symbols', async () => {
    const result = await tools.get('get_context')!({ filePath: 'src/a.ts', startLine: 1, mode: 'full' });
    expect((result as ToolResult).isError).toBeFalsy();
    const body = parse(result);
    expect(body.content).toContain('alpha');
    expect(JSON.stringify(body)).toContain('alpha-1');
  });

  it('get_file_structure accepts a relative path', async () => {
    const result = await tools.get('get_file_structure')!({ filePath: 'src/a.ts' });
    expect((result as ToolResult).isError).toBeFalsy();
    expect(JSON.stringify(parse(result))).toContain('alpha');
  });

  it('list_dependencies normalizes a relative filePath', async () => {
    const spy = vi.spyOn(store, 'getDependencies');
    await tools.get('list_dependencies')!({ filePath: 'src/a.ts' });
    expect(spy).toHaveBeenCalledWith(join(root, 'src', 'a.ts'), 'imports');
  });

  it('list_dependencies still accepts a missing filePath', async () => {
    const spy = vi.spyOn(store, 'getDependencies');
    await tools.get('list_dependencies')!({});
    expect(spy).toHaveBeenCalledWith(undefined, 'imports');
  });

  it('find_symbol normalizes a relative filePath', async () => {
    const result = await tools.get('find_symbol')!({ name: 'alpha', matchMode: 'exact', filePath: 'src/a.ts' });
    const body = parse(result);
    expect(body.symbols.length).toBe(1);
  });
});
