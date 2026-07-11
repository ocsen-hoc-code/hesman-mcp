import { compressToolResponse } from '../response-compressor';
import type { McpServer, ToolHandler } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';
import { compactCode } from '../../parsers/compact-mode';
import { ErrorCode, formatError } from '../error-codes';

const inputSchema = {
  type: 'object',
  properties: {
    symbolId: { type: 'string', description: 'Symbol ID to find references for' },
    referenceKind: { type: 'string', description: 'Filter: calls, import, extends, implements, type_ref, all' },
    topK: { type: 'number', description: 'Max results (default 50, max 200)' },
    cursor: { type: 'string', description: 'Pagination cursor from previous response' },
  },
  required: ['symbolId'],
};

export function registerGetReferencesTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async (args) => {
    const symbolId = args.symbolId as string;
    const referenceKind = args.referenceKind as string | undefined;
    const topK = Math.min((args.topK as number) || 50, 200);
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

    const compressed = compressToolResponse('get_references', { references, totalCount, hasMore, nextCursor, tookMs: 0 }, { store });
    return { content: [{ type: 'text', text: JSON.stringify(compressed) }] };
  };

  server.registerTool('get_references', 'Find all usages of a symbol', inputSchema, handler);
}
