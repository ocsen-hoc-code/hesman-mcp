import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import type { ZVecStore } from '../../stores/zvec.js';
import { isEmbeddingReady } from '../../stores/embedding.js';

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
            totalRelations: store.getTotalRelations(),
            lastFullIndexTime: stats.lastIndexTime ? new Date(stats.lastIndexTime).toISOString() : null,
            lastIncrementalIndexTime: null,
            pendingFiles: 0,
            health: {
              sqliteOk: true,
              zvecOk: zvecStore !== undefined,
              zvecDocCount: zvecStats?.docCount ?? 0,
              embeddingModelLoaded: isEmbeddingReady(),
            },
            languages: store.getLanguageStats(),
          }),
        },
      ],
    };
  };

  server.registerTool('index_status', 'Check the indexing status of the project', inputSchema, handler);
}
