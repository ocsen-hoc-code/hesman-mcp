import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import { ErrorCode, formatError } from '../error-codes.js';
import { intArg, withArgValidation } from '../args.js';
import type { HesmanConfig } from '../../config/schema.js';
import { normalizeProjectPath } from '../paths.js';
import { SYMBOL_KINDS } from '../../parsers/symbol-kinds.js';

const inputSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Symbol name to search for' },
    kind: {
      type: 'string',
      enum: [...SYMBOL_KINDS],
      description: 'Filter by symbol kind',
    },
    filePath: { type: 'string', description: 'Limit search to this file path' },
    matchMode: {
      type: 'string',
      enum: ['exact', 'fuzzy', 'prefix'],
      description: 'Match mode (default: "fuzzy"). exact=precise name, prefix=starts with, fuzzy=FTS5 text search',
    },
    topK: { type: 'integer', minimum: 1, maximum: 200, description: 'Max results (default 20, max 200)' },
  },
  required: ['name'],
};

export function registerFindSymbolTool(server: McpServer, store: SqliteStore, config: HesmanConfig): void {
  const handler: ToolHandler = async (args) => {
    const start = performance.now();
    const name = args.name as string;
    const kind = args.kind as string | undefined;
    const rawPath = args.filePath;
    // The index keys files by absolute path; resolve relative input against the root.
    const filePath =
      typeof rawPath === 'string' && rawPath.length > 0
        ? normalizeProjectPath(config.projectRoot, rawPath)
        : undefined;
    const topK = intArg(args, 'topK', { default: 20, min: 1, max: 200 });

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

    const tookMs = Math.round((performance.now() - start) * 100) / 100;
    const compressed = compressToolResponse('find_symbol', { symbols, tookMs }, { store });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(compressed),
        },
      ],
    };
  };

  server.registerTool('find_symbol', 'Find a symbol (function, class, variable, ...) by name', inputSchema, withArgValidation(handler));
}
