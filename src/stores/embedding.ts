import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { createLogger } from '../utils/logger';

const log = createLogger('embedding');

let embedPipeline: FeatureExtractionPipeline | null = null;

/**
 * Initialize the embedding pipeline. Call once on startup.
 * Downloads the model on first run (~80MB, cached indefinitely).
 */
export async function initEmbedding(modelName: string): Promise<void> {
  log.info({ model: modelName }, 'Loading embedding model...');
  embedPipeline = await pipeline('feature-extraction', modelName);
  log.info({ model: modelName }, 'Embedding model loaded');
}

/**
 * Embed a single text string into a normalized Float32Array.
 * Returns a 384-dim vector (all-MiniLM-L6-v2 output).
 */
export async function embedText(text: string): Promise<Float32Array> {
  if (!embedPipeline) throw new Error('Embedding pipeline not initialized. Call initEmbedding() first.');
  const result = await embedPipeline(text, { pooling: 'mean', normalize: true });
  return new Float32Array(result.data);
}

/**
 * Embed multiple texts. Transformers.js runs sequentially under the hood;
 * for Phase 2 this is acceptable. Worker-thread batching deferred to Phase 4.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const vectors: Float32Array[] = [];
  for (const text of texts) {
    vectors.push(await embedText(text));
  }
  return vectors;
}

/** Check if embedding model is loaded */
export function isEmbeddingReady(): boolean {
  return embedPipeline !== null;
}
