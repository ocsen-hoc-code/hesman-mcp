import type { McpServer, ToolHandler } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';

const inputSchema = {
  type: 'object',
  properties: {},
};

export function registerIndexStatusTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async () => {
    const stats = store.getStats();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            totalFiles: stats.totalFiles,
            indexedFiles: stats.totalFiles, // Phase 1: no pending concept (single-threaded)
            totalSymbols: stats.totalSymbols,
            totalRelations: 0, // Phase 1: no graph yet
            lastFullIndexTime: stats.lastIndexTime ? new Date(stats.lastIndexTime).toISOString() : null,
            lastIncrementalIndexTime: null,
            pendingFiles: 0,
            health: {
              sqliteOk: true,
              kuzuOk: false, // Phase 1: no Kuzu
              zvecOk: false, // Phase 1: no ZVec
              consistencyDrift: 0,
            },
            languages: [], // Phase 1: no per-language breakdown
          }),
        },
      ],
    };
  };

  server.registerTool('index_status', 'Check the indexing status of the project', inputSchema, handler);
}
