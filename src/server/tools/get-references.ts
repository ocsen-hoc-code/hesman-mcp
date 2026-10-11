import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import { compactCode } from '../../parsers/compact-mode.js';
import { ErrorCode, formatError } from '../error-codes.js';
import { intArg, withArgValidation } from '../args.js';

const inputSchema = {
  type: 'object',
  properties: {
    symbolId: { type: 'string', description: 'Symbol ID to find references for' },
    referenceKind: { type: 'string', description: 'Filter: calls, import, extends, implements, type_ref, all' },
    topK: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results (default 50, max 200)' },
    cursor: { type: 'string', description: 'Pagination cursor from previous response' },
  },
  required: ['symbolId'],
};

export function registerGetReferencesTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async (args) => {
    const start = performance.now();
    const symbolId = args.symbolId as string;
    const referenceKind = args.referenceKind as string | undefined;
    const topK = intArg(args, 'topK', { default: 50, min: 1, max: 200 });
    const cursor = args.cursor as string | undefined;

    if (!symbolId) {
      return { content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'symbolId is required')) }], isError: true };
    }

    // Map 'all' to undefined to skip kind filtering
    const kind = referenceKind === 'all' ? undefined : referenceKind;

    const { refs, totalCount, hasMore, nextCursor } = store.getReferences(symbolId, kind, topK, cursor);

    const references = refs.map(r => ({
      filePath: r.filePath,
      line: r.line,
      col: r.col,
      context: compactCode('...'), // context snippet deferred
      kind: r.kind,
      callerSymbolId: r.callerSymbolId,
      callerName: r.callerName,
    }));

    const tookMs = Math.round((performance.now() - start) * 100) / 100;
    const compressed = compressToolResponse('get_references', { references, totalCount, hasMore, nextCursor, tookMs }, { store });
    return { content: [{ type: 'text', text: JSON.stringify(compressed) }] };
  };

  server.registerTool('get_references', 'Find all usages of a symbol', inputSchema, withArgValidation(handler));
}
