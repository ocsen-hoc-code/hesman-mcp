import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import { ErrorCode, formatError } from '../error-codes.js';

const inputSchema = {
  type: 'object',
  properties: {
    symbolId: { type: 'string', description: 'Symbol ID to find callers for' },
    maxDepth: { type: 'number', description: 'Max call chain depth (default 1, max 3)' },
    topK: { type: 'number', description: 'Max results (default 50)' },
  },
  required: ['symbolId'],
};

export function registerGetCallersTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async (args) => {
    const symbolId = args.symbolId as string;
    const maxDepth = Math.min((args.maxDepth as number) || 1, 3);
    const topK = (args.topK as number) || 50;

    if (!symbolId) {
      return { content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'symbolId is required')) }], isError: true };
    }

    const start = performance.now();
    const callers = store.getCallers(symbolId, maxDepth, topK);
    const tookMs = Math.round((performance.now() - start) * 100) / 100;

    const compressed = compressToolResponse('get_callers', { callers, tookMs }, { store });
    return {
      content: [{ type: 'text', text: JSON.stringify(compressed) }],
    };
  };

  server.registerTool('get_callers', 'Find all callers of a symbol, with configurable call chain depth', inputSchema, handler);
}
