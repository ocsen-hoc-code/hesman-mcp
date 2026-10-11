import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { ZVecStore } from '../../stores/zvec.js';
import type { HesmanConfig } from '../../config/schema.js';
import { embedText, isEmbeddingReady } from '../../stores/embedding.js';
import { compactCode } from '../../parsers/compact-mode.js';
import { ErrorCode, formatError } from '../error-codes.js';
import { InvalidArgumentError, intArg, numberArg, withArgValidation } from '../args.js';
import { LANGUAGE_IDS, isLanguageId } from '../../parsers/languages.js';
import { SYMBOL_KINDS, isSymbolKind } from '../../parsers/symbol-kinds.js';

const inputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Natural language query to search for' },
    topK: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 10, max 50)' },
    filePattern: { type: 'string', description: 'Glob filter, e.g. "src/**/*.ts"' },
    language: { type: 'string', enum: [...LANGUAGE_IDS], description: 'Filter by language' },
    kind: { type: 'string', enum: [...SYMBOL_KINDS], description: 'Filter by symbol kind' },
    minScore: { type: 'number', minimum: 0, maximum: 1, description: 'Minimum score threshold (0-1, default 0.0). Scores are similarities, not probabilities: relevant matches typically score 0.3-0.6, so thresholds above 0.5 often return nothing. Prefer ranking by order.' },
  },
  required: ['query'],
};

/**
 * Read an optional string argument that must be one of a fixed set of values.
 * These values end up in a ZVec filter, so anything else is rejected outright.
 */
function enumArg(
  args: Record<string, unknown>,
  name: string,
  isValid: (value: string) => boolean,
  allowed: readonly string[],
): string | undefined {
  const raw = args[name];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || !isValid(raw)) {
    throw new InvalidArgumentError(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return raw;
}

export function registerSemanticSearchTool(
  server: McpServer,
  zvecStore: ZVecStore,
  config: HesmanConfig,
): void {
  const handler: ToolHandler = async (args) => {
    const query = args.query as string;
    const topK = intArg(args, 'topK', {
      default: config.semanticSearch.defaultTopK,
      min: 1,
      max: config.semanticSearch.maxTopK,
    });
    const filePattern = args.filePattern as string | undefined;
    const language = enumArg(args, 'language', isLanguageId, LANGUAGE_IDS);
    const kind = enumArg(args, 'kind', isSymbolKind, SYMBOL_KINDS);
    const minScore = numberArg(args, 'minScore', { default: config.semanticSearch.minScore, min: 0, max: 1 });

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
      queryText: query,
      topK,
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
    withArgValidation(handler),
  );
}
