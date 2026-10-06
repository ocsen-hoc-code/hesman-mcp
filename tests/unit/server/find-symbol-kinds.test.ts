import { describe, it, expect } from 'vitest';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import type { SqliteStore } from '../../../src/stores/sqlite.js';
import { registerFindSymbolTool } from '../../../src/server/tools/find-symbol.js';
import { defaultConfig } from '../../../src/config/defaults.js';
import { SYMBOL_KINDS } from '../../../src/parsers/symbol-kinds.js';

describe('find_symbol kind filter', () => {
  it('accepts exactly the shared SYMBOL_KINDS (same list as semantic_search)', () => {
    let schema: { properties: Record<string, { enum?: string[] }> } | undefined;
    const server = {
      registerTool(_name: string, _description: string, inputSchema: object, _handler: ToolHandler) {
        schema = inputSchema as typeof schema;
      },
    } as unknown as McpServer;

    registerFindSymbolTool(server, {} as SqliteStore, defaultConfig);

    expect(schema?.properties.kind.enum).toEqual([...SYMBOL_KINDS]);
  });
});
