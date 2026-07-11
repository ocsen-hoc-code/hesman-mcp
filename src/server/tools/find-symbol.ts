import { compressToolResponse } from '../response-compressor';
import type { McpServer, ToolHandler } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';
import { ErrorCode, formatError } from '../error-codes';

const inputSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Symbol name to search for' },
    kind: {
      type: 'string',
      enum: ['function', 'class', 'method', 'variable', 'interface', 'type', 'enum', 'namespace'],
      description: 'Filter by symbol kind',
    },
    filePath: { type: 'string', description: 'Limit search to this file path' },
    matchMode: {
      type: 'string',
      enum: ['exact', 'fuzzy', 'prefix'],
      description: 'Match mode (default: "fuzzy"). exact=precise name, prefix=starts with, fuzzy=FTS5 text search',
    },
    topK: { type: 'number', description: 'Max results (default 20)' },
  },
  required: ['name'],
};

export function registerFindSymbolTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async (args) => {
    const name = args.name as string;
    const kind = args.kind as string | undefined;
    const filePath = args.filePath as string | undefined;
    const topK = (args.topK as number) || 20;

    if (!name || typeof name !== 'string') {
      return {
        content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'name is required')) }],
        isError: true,
      };
    }

    const matchMode = (args.matchMode as 'exact' | 'fuzzy' | 'prefix') || 'fuzzy';
    const results = store.getSymbolsByName(name, kind, filePath, topK, matchMode);

    const symbols = results.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      filePath: s.file_path,
      startLine: s.start_line,
      endLine: s.end_line,
      signature: s.signature,
      docComment: s.doc_comment,
      isExported: s.is_exported === 1,
      parentName: null, // Phase 1: parent lookup deferred
      language: s.language,
    }));

    const compressed = compressToolResponse('find_symbol', { symbols, tookMs: 0 }, { store });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(compressed),
        },
      ],
    };
  };

  server.registerTool('find_symbol', 'Find a symbol (function, class, variable, ...) by name', inputSchema, handler);
}
