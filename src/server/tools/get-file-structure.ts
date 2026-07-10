import type { McpServer, ToolHandler } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';
import { ErrorCode, formatError } from '../error-codes';

const inputSchema = {
  type: 'object',
  properties: {
    filePath: { type: 'string', description: 'Path to the file to analyze' },
    includeNested: { type: 'boolean', description: 'Include nested symbols (methods in classes). Default: true' },
  },
  required: ['filePath'],
};

export function registerGetFileStructureTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async (args) => {
    const filePath = args.filePath as string;
    const includeNested = args.includeNested !== false;

    if (!filePath || typeof filePath !== 'string') {
      return {
        content: [
          { type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'filePath is required')) },
        ],
        isError: true,
      };
    }

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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            file: filePath,
            language,
            symbols,
            totalSymbols: allSymbols.length,
            tookMs: 0,
          }),
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
