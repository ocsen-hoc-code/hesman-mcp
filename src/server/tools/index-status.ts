import type { McpServer, ToolHandler } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';
import type { ZVecStore } from '../../stores/zvec';
import { isEmbeddingReady } from '../../stores/embedding';

const inputSchema = {
  type: 'object',
  properties: {},
};

export function registerIndexStatusTool(
  server: McpServer,
  store: SqliteStore,
  zvecStore?: ZVecStore,
): void {
  const handler: ToolHandler = async () => {
    const stats = store.getStats();
    const zvecStats = zvecStore?.stats();

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
              zvecOk: zvecStore !== undefined,
              zvecDocCount: zvecStats?.docCount ?? 0,
              embeddingModelLoaded: isEmbeddingReady(),
              kuzuOk: false, // Phase 1: no Kuzu
            },
            languages: [], // Phase 1: no per-language breakdown
          }),
        },
      ],
    };
  };

  server.registerTool('index_status', 'Check the indexing status of the project', inputSchema, handler);
}
