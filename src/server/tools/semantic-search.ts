import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { ZVecStore } from '../../stores/zvec.js';
import type { HesmanConfig } from '../../config/schema.js';
import { embedText, isEmbeddingReady } from '../../stores/embedding.js';
import { compactCode } from '../../parsers/compact-mode.js';
import { ErrorCode, formatError } from '../error-codes.js';

const inputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Natural language query to search for' },
    topK: { type: 'number', description: 'Max results (default 10, max 50)' },
    filePattern: { type: 'string', description: 'Glob filter, e.g. "src/**/*.ts"' },
    language: { type: 'string', description: 'Filter by language: typescript, python, ...' },
    kind: { type: 'string', description: 'Filter by symbol kind: function, class, method, ...' },
    minScore: { type: 'number', description: 'Minimum score threshold (0-1, default 0.0)' },
  },
  required: ['query'],
};

export function registerSemanticSearchTool(
  server: McpServer,
  zvecStore: ZVecStore,
  config: HesmanConfig,
): void {
  const handler: ToolHandler = async (args) => {
    const query = args.query as string;
    const topK = (args.topK as number) ?? config.semanticSearch.defaultTopK;
    const filePattern = args.filePattern as string | undefined;
    const language = args.language as string | undefined;
    const kind = args.kind as string | undefined;
    const minScore = (args.minScore as number) ?? config.semanticSearch.minScore;

    // Validate
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'query is required and must be non-empty')) }],
        isError: true,
      };
    }

    if (!config.semanticSearch.enabled) {
      return {
        content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'Semantic search is disabled in config')) }],
        isError: true,
      };
    }

    if (!isEmbeddingReady()) {
      return {
        content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INDEX_NOT_READY, 'Embedding model not loaded. Run once with internet to download.')) }],
        isError: true,
      };
    }

    const maxTopK = config.semanticSearch.maxTopK;
    const effectiveTopK = Math.min(Math.max(1, topK), maxTopK);

    const embedStart = Date.now();

    let queryVector: Float32Array;
    try {
      queryVector = await embedText(query.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INTERNAL_ERROR, `Embedding failed: ${message}`)) }],
        isError: true,
      };
    }

    const embedTookMs = Date.now() - embedStart;

    const searchStart = Date.now();
    let results = zvecStore.search({
      queryVector,
      topK: effectiveTopK,
      filePattern,
      language,
      kind,
    });
    const searchTookMs = Date.now() - searchStart;

    // Apply minScore + compact snippets
    results = results
      .filter(r => r.score >= minScore)
      .map(r => ({
        ...r,
        snippet: compactCode(r.snippet),
      }));

    const compressed = compressToolResponse('semantic_search', {
      results,
      totalFound: results.length,
      tookMs: embedTookMs + searchTookMs,
      embeddingTookMs: embedTookMs,
    }, {});
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(compressed),
      }],
    };
  };

  server.registerTool(
    'semantic_search',
    'Search code by natural language description using AI embeddings',
    inputSchema,
    handler,
  );
}
