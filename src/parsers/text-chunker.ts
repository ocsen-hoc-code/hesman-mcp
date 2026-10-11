/**
 * Chunker of the text tier (M1-04): files without a grammar are split into
 * line ranges instead of symbols.
 *
 * Kept apart from `chunker.ts` (the symbol chunker): no parser is involved and
 * nothing here knows about symbols.
 */

import { createHash } from 'node:crypto';

/** `kind` of a text chunk in the vector store and in `semantic_search` results. */
export const TEXT_CHUNK_KIND = 'text';

/**
 * Most lines in one chunk. The embedding model reads about 256 tokens, so
 * longer chunks would mostly be ignored by it; shorter ones multiply the
 * number of vectors per file.
 */
export const TEXT_CHUNK_MAX_LINES = 30;

/**
 * Most chunks indexed for one file. Lines past the last chunk are not embedded
 * (`find_pattern` and `get_context` still read the whole file from disk).
 */
export const MAX_TEXT_CHUNKS_PER_FILE = 300;

export interface TextChunk {
  /** 1-based line of the first line of the chunk. */
  startLine: number;
  /** 1-based line of the last line of the chunk (inclusive). */
  endLine: number;
  /** Lines `startLine..endLine` joined with `\n` (no `\r`, no trailing newline). */
  text: string;
}

/**
 * Split text into chunks of at most `maxLines` lines.
 *
 * Blocks are runs of non-blank lines separated by blank lines. Consecutive
 * blocks are packed into one chunk while they fit, so a chunk always starts
 * and ends on a block boundary unless a single block is longer than
 * `maxLines` — that block is cut every `maxLines` lines. Blank lines between
 * two chunks belong to neither. At most `MAX_TEXT_CHUNKS_PER_FILE` chunks are
 * returned.
 */
export function chunkText(content: string, maxLines: number = TEXT_CHUNK_MAX_LINES): TextChunk[] {
  const lines = content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const chunks: TextChunk[] = [];
  /** Open chunk as 0-based inclusive line indexes, or -1 when none is open. */
  let chunkStart = -1;
  let chunkEnd = -1;

  const flush = (): void => {
    if (chunkStart === -1) return;
    chunks.push({
      startLine: chunkStart + 1,
      endLine: chunkEnd + 1,
      text: lines.slice(chunkStart, chunkEnd + 1).join('\n'),
    });
    chunkStart = -1;
  };

  let i = 0;
  while (i < lines.length && chunks.length < MAX_TEXT_CHUNKS_PER_FILE) {
    if (lines[i].trim() === '') {
      i++;
      continue;
    }
    let blockEnd = i;
    while (blockEnd + 1 < lines.length && lines[blockEnd + 1].trim() !== '') blockEnd++;

    if (chunkStart !== -1 && blockEnd - chunkStart + 1 > maxLines) flush();
    if (chunkStart === -1) {
      // A block longer than the cap is cut into full pieces; its tail stays open.
      let start = i;
      while (blockEnd - start + 1 > maxLines && chunks.length < MAX_TEXT_CHUNKS_PER_FILE) {
        chunkStart = start;
        chunkEnd = start + maxLines - 1;
        flush();
        start += maxLines;
      }
      chunkStart = start;
    }
    chunkEnd = blockEnd;
    i = blockEnd + 1;
  }
  if (chunks.length < MAX_TEXT_CHUNKS_PER_FILE) flush();
  return chunks;
}

/**
 * Id of the `index`-th chunk (0-based) of a file. It depends only on the path
 * and the position, so re-indexing an unchanged file yields the same ids and
 * the ids of a file can be rebuilt from its chunk count. It cannot collide
 * with a symbol id of the same file, whose hashed text has four fields.
 */
export function textChunkId(filePath: string, index: number): string {
  // Same shape as a symbol id (16 hex characters): ZVec rejects ids with
  // characters such as `#`, and agents treat both kinds of id as opaque.
  return createHash('sha256').update(`${filePath}:text-chunk:${index}`).digest('hex').slice(0, 16);
}

/** Ids of every chunk of a file that has `chunkCount` chunks. */
export function textChunkIds(filePath: string, chunkCount: number): string[] {
  return Array.from({ length: chunkCount }, (_, index) => textChunkId(filePath, index));
}
