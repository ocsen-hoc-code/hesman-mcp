import { describe, it, expect } from 'vitest';
import {
  MAX_TEXT_CHUNKS_PER_FILE,
  TEXT_CHUNK_MAX_LINES,
  chunkText,
  textChunkId,
  textChunkIds,
} from '../../../src/parsers/text-chunker.js';

describe('chunkText', () => {
  it('returns no chunk for empty or whitespace-only content', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('\n\n  \n\t\n')).toEqual([]);
  });

  it('reports 1-based inclusive line ranges', () => {
    const chunks = chunkText('alpha\nbeta\n');
    expect(chunks).toEqual([{ startLine: 1, endLine: 2, text: 'alpha\nbeta' }]);
  });

  it('packs small blank-line-separated blocks into one chunk while they fit', () => {
    const chunks = chunkText('a1\na2\n\nb1\nb2\n\nc1\n', 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 7 });
    expect(chunks[0].text).toBe('a1\na2\n\nb1\nb2\n\nc1');
  });

  it('starts a new chunk at a block boundary when the next block does not fit', () => {
    // Blocks: lines 1-3, 5-7, 9-10. With a cap of 7, block 2 fits (1-7), block 3 does not.
    const chunks = chunkText('a\na\na\n\nb\nb\nb\n\nc\nc\n', 7);
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([[1, 7], [9, 10]]);
    expect(chunks[1].text).toBe('c\nc');
  });

  it('splits a block longer than the cap into pieces of at most the cap', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line${i + 1}`);
    const chunks = chunkText(lines.join('\n'), 10);
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([[1, 10], [11, 20], [21, 25]]);
    expect(chunks[2].text.split('\n')[0]).toBe('line21');
  });

  it('never produces a chunk longer than the cap', () => {
    const source = Array.from({ length: 500 }, (_, i) => (i % 7 === 0 ? '' : `row ${i}`)).join('\n');
    for (const chunk of chunkText(source)) {
      expect(chunk.endLine - chunk.startLine + 1).toBeLessThanOrEqual(TEXT_CHUNK_MAX_LINES);
      expect(chunk.text.split('\n')).toHaveLength(chunk.endLine - chunk.startLine + 1);
    }
  });

  it('skips leading blank lines and treats whitespace-only lines as blank', () => {
    const chunks = chunkText('\n\nfirst\n   \nsecond\n', 1);
    expect(chunks).toEqual([
      { startLine: 3, endLine: 3, text: 'first' },
      { startLine: 5, endLine: 5, text: 'second' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const chunks = chunkText('one\r\ntwo\r\n\r\nthree\r\n', 2);
    expect(chunks).toEqual([
      { startLine: 1, endLine: 2, text: 'one\ntwo' },
      { startLine: 4, endLine: 4, text: 'three' },
    ]);
  });

  it('caps the number of chunks of one file', () => {
    const source = Array.from({ length: (MAX_TEXT_CHUNKS_PER_FILE + 5) * 2 }, (_, i) => (i % 2 === 0 ? `row ${i}` : '')).join('\n');
    expect(chunkText(source, 1)).toHaveLength(MAX_TEXT_CHUNKS_PER_FILE);
  });
});

describe('textChunkId', () => {
  it('is deterministic and derived from the file path and chunk position', () => {
    expect(textChunkId('/p/Makefile', 0)).toBe(textChunkId('/p/Makefile', 0));
    expect(textChunkId('/p/Makefile', 0)).not.toBe(textChunkId('/p/Makefile', 1));
    expect(textChunkId('/p/Makefile', 0)).not.toBe(textChunkId('/p/other', 0));
  });

  it('lists the ids of a file from its chunk count', () => {
    expect(textChunkIds('/p/a.sql', 3)).toEqual([0, 1, 2].map((i) => textChunkId('/p/a.sql', i)));
    expect(textChunkIds('/p/a.sql', 0)).toEqual([]);
  });
});
