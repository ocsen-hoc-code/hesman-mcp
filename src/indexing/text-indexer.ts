/**
 * Storage side of the text tier (M1-04), shared by the index coordinator and
 * the file watcher.
 *
 * A text-tier file has one row in SQLite (`text_files`: language, line and
 * chunk counts) and, when semantic search is on, one ZVec document per chunk.
 * Chunk ids are derived from the path and the chunk position, so the chunk
 * count in SQLite is all that is needed to delete a file's documents — the
 * same lifecycle symbols have (file hash, `deleteByFile`, watcher events).
 */
import { basename } from 'node:path';
import { splitIdentifier } from '../parsers/chunker.js';
import { TEXT_CHUNK_KIND, chunkText, textChunkId, textChunkIds, type TextChunk } from '../parsers/text-chunker.js';
import { embedBatch } from '../stores/embedding.js';
import type { SqliteStore } from '../stores/sqlite.js';
import type { SearchDoc, ZVecStore } from '../stores/zvec.js';

/** Chunks embedded between two calls of `beforeBatch` (abort / event-loop checkpoints). */
const EMBED_BATCH_SIZE = 16;

export interface TextFileInput {
  filePath: string;
  /** Text-tier language label. */
  language: string;
  content: string;
}

export interface IndexTextFileOptions {
  /**
   * Awaited before each batch of embeddings. May throw to cancel: nothing has
   * been written for the file at that point, so the store stays consistent.
   */
  beforeBatch?: () => Promise<void>;
}

/** Text embedded for a chunk: language and file name words, then the lines themselves. */
function embeddingText(file: TextFileInput, chunk: TextChunk): string {
  return `${file.language} ${splitIdentifier(basename(file.filePath)).join(' ')}\n${chunk.text}`;
}

/** Ids of the vector documents currently stored for a text-tier file. */
export function storedTextChunkIds(store: SqliteStore, filePath: string): string[] {
  const record = store.getTextFile(filePath);
  return record ? textChunkIds(filePath, record.chunk_count) : [];
}

/**
 * Indexes one file as text, replacing whatever the text tier stored for it
 * before. Returns the number of chunks. The caller owns the file hash and any
 * symbols the file had in the parsed tier.
 */
export async function indexTextFile(
  store: SqliteStore,
  zvecStore: ZVecStore | undefined,
  file: TextFileInput,
  options: IndexTextFileOptions = {},
): Promise<number> {
  const chunks = chunkText(file.content);

  // Embed first: a cancelled or failed embedding leaves the previous state untouched.
  const embeddings: Float32Array[] = [];
  if (zvecStore) {
    for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
      await options.beforeBatch?.();
      const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
      embeddings.push(...(await embedBatch(batch.map((chunk) => embeddingText(file, chunk)))));
    }
  }

  const previousIds = storedTextChunkIds(store, file.filePath);
  if (zvecStore) {
    zvecStore.deleteByFile(file.filePath, previousIds);
    const name = basename(file.filePath);
    const docs: SearchDoc[] = chunks.map((chunk, index) => ({
      symbolId: textChunkId(file.filePath, index),
      name,
      kind: TEXT_CHUNK_KIND,
      filePath: file.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      signature: null,
      code: chunk.text,
      docComment: null,
      language: file.language,
    }));
    zvecStore.upsertDocs(docs, embeddings);
  }

  const lines = file.content.split('\n');
  // A trailing newline terminates the last line; it does not start another one.
  if (lines[lines.length - 1] === '') lines.pop();
  store.upsertTextFile({
    file_path: file.filePath,
    language: file.language,
    line_count: lines.length,
    chunk_count: chunks.length,
  });
  return chunks.length;
}

/** Removes everything the text tier stored for a file (no-op when it stored nothing). */
export function removeTextFile(store: SqliteStore, zvecStore: ZVecStore | undefined, filePath: string): void {
  const ids = storedTextChunkIds(store, filePath);
  if (ids.length > 0) zvecStore?.deleteByFile(filePath, ids);
  store.clearTextFile(filePath);
}
