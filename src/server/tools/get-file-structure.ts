import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import { ErrorCode, formatError } from '../error-codes.js';
import type { HesmanConfig } from '../../config/schema.js';
import { normalizeProjectPath } from '../paths.js';

const inputSchema = {
  type: 'object',
  properties: {
    filePath: { type: 'string', description: 'Path to the file to analyze' },
    includeNested: { type: 'boolean', description: 'Include nested symbols (methods in classes). Default: true' },
  },
  required: ['filePath'],
};

export function registerGetFileStructureTool(server: McpServer, store: SqliteStore, config: HesmanConfig): void {
  const handler: ToolHandler = async (args) => {
    const start = performance.now();
    const rawPath = args.filePath;
    const includeNested = args.includeNested !== false;

    if (!rawPath || typeof rawPath !== 'string') {
      return {
        content: [
          { type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'filePath is required')) },
        ],
        isError: true,
      };
    }

    // The index keys files by absolute path; resolve relative input against the root.
    const filePath = normalizeProjectPath(config.projectRoot, rawPath);
    const allSymbols = store.getSymbolsByFile(filePath);

    if (allSymbols.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              formatError(ErrorCode.FILE_NOT_FOUND, `No symbols found for file: ${filePath}`),
            ),
          },
        ],
        isError: true,
      };
    }

    // Build hierarchy: top-level symbols with nested children
    const topLevel = allSymbols.filter((s) => s.parent_id === null);
    const children = allSymbols.filter((s) => s.parent_id !== null);

    const symbols = topLevel.map((s) => {
      const result: Record<string, unknown> = {
        id: s.id,
        name: s.name,
        kind: s.kind,
        startLine: s.start_line,
        endLine: s.end_line,
        signature: s.signature,
        isExported: s.is_exported === 1,
      };
      if (includeNested) {
        const nested = children
          .filter((c) => c.parent_id === s.id)
          .map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            startLine: c.start_line,
            endLine: c.end_line,
            signature: c.signature,
            isExported: c.is_exported === 1,
          }));
        if (nested.length > 0) result.children = nested;
      }
      return result;
    });

    const language = allSymbols[0]?.language || 'unknown';

    const compressed = compressToolResponse('get_file_structure', {
      file: filePath,
      language,
      symbols,
      totalSymbols: allSymbols.length,
      tookMs: Math.round((performance.now() - start) * 100) / 100,
    }, { store });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(compressed),
        },
      ],
    };
  };

  server.registerTool(
    'get_file_structure',
    'Get the symbol structure of a file (functions, classes, methods, ...)',
    inputSchema,
    handler,
  );
}
