import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../../../src/stores/sqlite.js';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import { registerAllTools } from '../../../src/server/tools/index.js';
import { defaultConfig } from '../../../src/config/defaults.js';

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

const SOURCE = [
  '// A comment the compact mode strips.',
  'export function alpha(): number {',
  '  // Inner comment.',
  '  return 1;',
  '}',
  '',
].join('\n');

describe('get_context mode', () => {
  let root: string;
  let dataDir: string;
  let store: SqliteStore;
  let getContext: ToolHandler;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hesman-get-context-mode-'));
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-get-context-mode-data-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), SOURCE);
    store = new SqliteStore(dataDir);
    store.open();
    const tools = new Map<string, ToolHandler>();
    const server = {
      registerTool(name: string, _description: string, _inputSchema: object, handler: ToolHandler) {
        tools.set(name, handler);
      },
    } as unknown as McpServer;
    registerAllTools(server, store, undefined, { ...defaultConfig, projectRoot: root });
    getContext = tools.get('get_context')!;
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function content(mode: 'full' | 'compact'): Promise<string> {
    const result = (await getContext({ filePath: 'src/a.ts', startLine: 2, contextLines: 5, mode })) as ToolResult;
    expect(result.isError).toBeFalsy();
    return (JSON.parse(result.content[0].text ?? '{}') as { content: string }).content;
  }

  it('returns the source verbatim in full mode, comments included', async () => {
    const full = await content('full');
    expect(full).toContain('// A comment the compact mode strips.');
    expect(full).toContain('// Inner comment.');
  });

  it('strips comments in compact mode', async () => {
    const compact = await content('compact');
    expect(compact).not.toContain('// A comment the compact mode strips.');
    expect(compact).toContain('return 1;');
  });
});
