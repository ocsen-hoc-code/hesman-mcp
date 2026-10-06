import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import type { ZVecStore } from '../../../src/stores/zvec.js';
import { registerSemanticSearchTool } from '../../../src/server/tools/semantic-search.js';
import { defaultConfig } from '../../../src/config/defaults.js';
import { LANGUAGE_IDS } from '../../../src/parsers/languages.js';
import { SYMBOL_KINDS } from '../../../src/parsers/symbol-kinds.js';

interface CapturedTool {
  inputSchema: { properties: Record<string, Record<string, unknown>> };
  handler: ToolHandler;
}

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

function parse(result: unknown): { error?: { code: string; message: string } } {
  return JSON.parse((result as ToolResult).content[0].text ?? '{}') as {
    error?: { code: string; message: string };
  };
}

describe('semantic_search argument validation', () => {
  let tool: CapturedTool;
  let search: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    let captured: CapturedTool | undefined;
    const server = {
      registerTool(_name: string, _description: string, inputSchema: object, handler: ToolHandler) {
        captured = { inputSchema: inputSchema as CapturedTool['inputSchema'], handler };
      },
    } as unknown as McpServer;
    search = vi.fn(() => []);
    const zvecStore = { search } as unknown as ZVecStore;
    registerSemanticSearchTool(server, zvecStore, defaultConfig);
    tool = captured!;
  });

  it('rejects a kind that tries to inject into the filter expression', async () => {
    const result = (await tool.handler({ query: 'add numbers', kind: "function' OR '1'='1" })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(parse(result).error?.code).toBe('INVALID_INPUT');
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects a language that is not in the registry', async () => {
    const result = (await tool.handler({ query: 'add numbers', language: "typescript' OR '1'='1" })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(parse(result).error?.code).toBe('INVALID_INPUT');
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects non-string kind and language values', async () => {
    for (const args of [{ kind: 42 }, { language: ['typescript'] }]) {
      const result = (await tool.handler({ query: 'add numbers', ...args })) as ToolResult;
      expect(parse(result).error?.code).toBe('INVALID_INPUT');
    }
  });

  it('exposes the valid kinds and languages as enums in the input schema', () => {
    expect(tool.inputSchema.properties.kind.enum).toEqual([...SYMBOL_KINDS]);
    expect(tool.inputSchema.properties.language.enum).toEqual([...LANGUAGE_IDS]);
  });
});
