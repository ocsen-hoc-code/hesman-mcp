import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import type { HesmanConfig } from '../../config/schema.js';
import { ErrorCode, formatError } from '../error-codes.js';
import { formatArg, intArg, withArgValidation } from '../args.js';
import { tierNoteField } from '../tier-note.js';

const inputSchema = {
  type: 'object',
  properties: {
    symbolId: { type: 'string', description: 'Symbol ID to find callers for' },
    maxDepth: { type: 'integer', minimum: 1, maximum: 3, description: 'Max call chain depth (default 1, max 3)' },
    topK: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results (default 50, max 200)' },
    format: {
      type: 'string',
      enum: ['compact', 'full'],
      description:
        'Response shape (default "compact"): entries grouped by file under "files", each row an array under the named "columns" (callFile is set only when the call site is in another file), paths relative to the project. "full" returns one object per entry with absolute paths.',
    },
  },
  required: ['symbolId'],
};

export function registerGetCallersTool(server: McpServer, store: SqliteStore, config: HesmanConfig): void {
  const handler: ToolHandler = async (args) => {
    const symbolId = args.symbolId as string;
    const maxDepth = intArg(args, 'maxDepth', { default: 1, min: 1, max: 3 });
    const topK = intArg(args, 'topK', { default: 50, min: 1, max: 200 });
    const format = formatArg(args);

    if (!symbolId) {
      return { content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'symbolId is required')) }], isError: true };
    }

    const start = performance.now();
    const callers = store.getCallers(symbolId, maxDepth, topK);
    const tookMs = Math.round((performance.now() - start) * 100) / 100;

    const compressed = compressToolResponse(
      'get_callers',
      { callers, tookMs, ...tierNoteField(store, symbolId, 'call graph') },
      { store, format, projectRoot: config.projectRoot },
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(compressed) }],
    };
  };

  server.registerTool('get_callers', 'Find all callers of a symbol, with configurable call chain depth', inputSchema, withArgValidation(handler));
}
