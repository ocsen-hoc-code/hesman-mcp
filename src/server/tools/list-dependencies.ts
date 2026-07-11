import { compressToolResponse } from '../response-compressor';
import type { McpServer, ToolHandler } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';
import { ErrorCode, formatError } from '../error-codes';

const inputSchema = {
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      description: 'File path to analyze (optional; returns all project-level imports if omitted)',
    },
    direction: {
      type: 'string',
      enum: ['imports', 'imported_by', 'both'],
      description: 'Direction: "imports" (default, what the file imports), "imported_by" (what imports from the file), or "both"',
    },
  },
};

export function registerListDependenciesTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async (args) => {
    const filePath = args.filePath as string | undefined;
    const direction = (args.direction as string) || 'imports';

    if (!['imports', 'imported_by', 'both'].includes(direction)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'direction must be "imports", "imported_by", or "both"')),
          },
        ],
        isError: true,
      };
    }

    const start = performance.now();
    const dependencies = store.getDependencies(filePath, direction as 'imports' | 'imported_by' | 'both');
    const tookMs = Math.round((performance.now() - start) * 100) / 100;

    const compressed = compressToolResponse('list_dependencies', {
      file: filePath || null,
      dependencies,
      tookMs,
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
    'list_dependencies',
    'List dependencies for a file or across the project — file imports, reverse imports, or both',
    inputSchema,
    handler,
  );
}
