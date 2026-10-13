import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INDEX_SCHEMA_VERSION, SqliteStore } from '../../../src/stores/sqlite.js';

describe('SqliteStore text-tier files', () => {
  let dataDir: string;
  let store: SqliteStore;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-sqlite-text-'));
    store = new SqliteStore(dataDir);
    store.open();
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('bumps the index schema version so existing indexes pick up the text tier', () => {
    expect(INDEX_SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
  });

  it('stores and returns a text file record', () => {
    expect(store.getTextFile('/p/a.sql')).toBeUndefined();
    store.upsertTextFile({ file_path: '/p/a.sql', language: 'sql', line_count: 40, chunk_count: 2 });
    expect(store.getTextFile('/p/a.sql')).toMatchObject({
      file_path: '/p/a.sql',
      language: 'sql',
      line_count: 40,
      chunk_count: 2,
    });
  });

  it('replaces the record of a re-indexed file', () => {
    store.upsertTextFile({ file_path: '/p/a.sql', language: 'sql', line_count: 40, chunk_count: 2 });
    store.upsertTextFile({ file_path: '/p/a.sql', language: 'sql', line_count: 10, chunk_count: 1 });
    expect(store.getTextFile('/p/a.sql')).toMatchObject({ line_count: 10, chunk_count: 1 });
    expect(store.getTextStats()).toEqual({ files: 1, chunks: 1 });
  });

  it('removes a text file record', () => {
    store.upsertTextFile({ file_path: '/p/a.sql', language: 'sql', line_count: 40, chunk_count: 2 });
    store.clearTextFile('/p/a.sql');
    expect(store.getTextFile('/p/a.sql')).toBeUndefined();
    expect(store.getTextStats()).toEqual({ files: 0, chunks: 0 });
  });

  it('reports totals and per-language counts', () => {
    store.upsertTextFile({ file_path: '/p/a.sql', language: 'sql', line_count: 40, chunk_count: 2 });
    store.upsertTextFile({ file_path: '/p/b.sql', language: 'sql', line_count: 5, chunk_count: 1 });
    store.upsertTextFile({ file_path: '/p/Makefile', language: 'makefile', line_count: 5, chunk_count: 1 });
    expect(store.getTextStats()).toEqual({ files: 3, chunks: 4 });
    expect(store.getTextLanguageStats()).toEqual([
      { language: 'sql', files: 2, chunks: 3 },
      { language: 'makefile', files: 1, chunks: 1 },
    ]);
  });

  it('does not count text files as symbols', () => {
    store.upsertTextFile({ file_path: '/p/a.sql', language: 'sql', line_count: 40, chunk_count: 2 });
    expect(store.getStats()).toMatchObject({ totalFiles: 0, totalSymbols: 0 });
    expect(store.getSymbolsByFile('/p/a.sql')).toEqual([]);
    expect(store.getLanguageStats()).toEqual([]);
  });

  it('clearIndex drops text file records too', () => {
    store.upsertTextFile({ file_path: '/p/a.sql', language: 'sql', line_count: 40, chunk_count: 2 });
    store.clearIndex();
    expect(store.getTextStats()).toEqual({ files: 0, chunks: 0 });
  });
});
