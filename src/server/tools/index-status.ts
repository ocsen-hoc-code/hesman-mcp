import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import type { ZVecStore } from '../../stores/zvec.js';
import { isEmbeddingReady } from '../../stores/embedding.js';
import { indexState } from '../../indexing/index-state.js';
import { grammarReport } from '../../parsers/grammar-report.js';

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
    const indexing = indexState.snapshot();
    const languages = store.getLanguageStats();
    const textLanguages = store.getTextLanguageStats();

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
            // Files the running initial index has not handled yet; 0 when idle.
            pendingFiles: indexing.inProgress ? Math.max(0, indexing.filesTotal - indexing.filesDone) : 0,
            indexing: {
              inProgress: indexing.inProgress,
              phase: indexing.phase,
              filesDone: indexing.filesDone,
              filesTotal: indexing.filesTotal,
              startedAt: indexing.startedAt !== null ? new Date(indexing.startedAt).toISOString() : null,
              error: indexing.error,
            },
            health: {
              sqliteOk: true,
              zvecOk: zvecStore !== undefined,
              zvecDocCount: zvecStats?.docCount ?? 0,
              embeddingModelLoaded: isEmbeddingReady(),
              embeddingModelError: indexing.modelError,
            },
            languages,
            // Files without a grammar, indexed as text chunks (no symbols).
            textTier: { ...store.getTextStats(), languages: textLanguages },
            // Per indexed language: grammar bundled / cached / missing, and why (M1-05).
            grammars: grammarReport(languages, textLanguages),
          }),
        },
      ],
    };
  };

  server.registerTool(
    'index_status',
    'Check the indexing status of the project, including progress of the initial background index',
    inputSchema,
    handler,
  );
}
