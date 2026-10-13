import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import { ErrorCode, formatError } from '../error-codes.js';
import type { HesmanConfig } from '../../config/schema.js';
import { normalizeProjectPath } from '../paths.js';
import { formatArg, withArgValidation } from '../args.js';

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
    format: {
      type: 'string',
      enum: ['compact', 'full'],
      description:
        'Response shape (default "compact"): one row per dependency under the named "columns", paths relative to the project. "full" returns one object per dependency.',
    },
  },
};

export function registerListDependenciesTool(server: McpServer, store: SqliteStore, config: HesmanConfig): void {
  const handler: ToolHandler = async (args) => {
    const rawPath = args.filePath;
    // The index keys files by absolute path; resolve relative input against the root.
    const filePath =
      typeof rawPath === 'string' && rawPath.length > 0
        ? normalizeProjectPath(config.projectRoot, rawPath)
        : undefined;
    const direction = (args.direction as string) || 'imports';
    const format = formatArg(args);

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
    }, { store, format, projectRoot: config.projectRoot });
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
    withArgValidation(handler),
  );
}
