import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../../../src/parsers/languages.js';
import { LANGUAGE_TIERS, healthRows, indexSummary, languageRows } from '../../../src/ui/public/js/lib/status-model.js';

describe('language tiers shown on the overview', () => {
  it('lists every registered language with the tier of the registry', () => {
    const registry = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.tier]));
    expect(LANGUAGE_TIERS).toEqual(registry);
  });

  it('labels rows from index_status, preferring a tier sent by the server', () => {
    const rows = languageRows({
      languages: [
        { language: 'go', files: 2, symbols: 9 },
        { language: 'ruby', files: 1, symbols: 3 },
        { language: 'zig', files: 1, symbols: 1 },
        { language: 'c', files: 1, symbols: 1, tier: 'deep' },
      ],
      textTier: { files: 3, chunks: 7, languages: [{ language: 'markdown', files: 3, chunks: 7 }] },
    });
    expect(rows).toEqual([
      { language: 'go', tier: 'deep', files: 2, symbols: 9, chunks: null },
      { language: 'ruby', tier: 'structural', files: 1, symbols: 3, chunks: null },
      { language: 'zig', tier: 'unknown', files: 1, symbols: 1, chunks: null },
      { language: 'c', tier: 'deep', files: 1, symbols: 1, chunks: null },
      { language: 'markdown', tier: 'text', files: 3, symbols: null, chunks: 7 },
    ]);
  });

  it('is empty for a missing payload', () => {
    expect(languageRows(undefined)).toEqual([]);
    expect(languageRows({})).toEqual([]);
  });
});

describe('indexSummary', () => {
  const idle = { inProgress: false, phase: 'ready', filesDone: 10, filesTotal: 10, startedAt: null, error: null };

  it('reports a finished index', () => {
    expect(indexSummary({ totalFiles: 10, indexing: idle })).toEqual({ state: 'ok', label: 'Index ready', progress: null, detail: '' });
  });

  it('reports progress while indexing', () => {
    const s = indexSummary({ totalFiles: 3, indexing: { ...idle, inProgress: true, phase: 'indexing', filesDone: 3, filesTotal: 12 } });
    expect(s).toEqual({ state: 'busy', label: 'Indexing', progress: 0.25, detail: '3 of 12 files' });
  });

  it('names the phase after the files are read', () => {
    const s = indexSummary({ indexing: { ...idle, inProgress: true, phase: 'resolving', filesDone: 12, filesTotal: 12 } });
    expect(s).toMatchObject({ state: 'busy', label: 'Resolving relations', progress: 1 });
  });

  it('has no progress number before the file count is known', () => {
    const s = indexSummary({ indexing: { ...idle, inProgress: true, phase: 'scanning', filesDone: 0, filesTotal: 0 } });
    expect(s).toMatchObject({ state: 'busy', label: 'Scanning files', progress: null, detail: '' });
  });

  it('reports a failed index with its message', () => {
    const s = indexSummary({ indexing: { ...idle, phase: 'failed', error: 'disk full' } });
    expect(s).toEqual({ state: 'error', label: 'Indexing failed', progress: null, detail: 'disk full' });
  });

  it('reports an empty index', () => {
    expect(indexSummary({ totalFiles: 0, textTier: { files: 0 }, indexing: idle })).toMatchObject({ state: 'warn', label: 'Nothing indexed yet' });
    expect(indexSummary({ totalFiles: 0, textTier: { files: 2 }, indexing: idle })).toMatchObject({ state: 'ok' });
  });

  it('tolerates a missing payload', () => {
    expect(indexSummary(undefined)).toMatchObject({ state: 'pending', label: 'Unknown' });
  });
});

describe('healthRows', () => {
  it('describes each store and the embedding model', () => {
    const rows = healthRows({ sqliteOk: true, zvecOk: false, zvecDocCount: 0, embeddingModelLoaded: false, embeddingModelError: 'no model file' });
    expect(rows).toEqual([
      { name: 'Symbol database', state: 'ok', label: 'Working', detail: '' },
      { name: 'Vector store', state: 'error', label: 'Unavailable', detail: 'Semantic search does not work without it.' },
      { name: 'Embedding model', state: 'error', label: 'Failed to load', detail: 'no model file' },
    ]);
  });

  it('shows the document count and a model that is still loading', () => {
    const rows = healthRows({ sqliteOk: true, zvecOk: true, zvecDocCount: 1234, embeddingModelLoaded: false, embeddingModelError: null });
    expect(rows[1]).toEqual({ name: 'Vector store', state: 'ok', label: 'Working', detail: '1,234 documents' });
    expect(rows[2]).toEqual({ name: 'Embedding model', state: 'warn', label: 'Not loaded', detail: 'Semantic search is unavailable until the model loads.' });
  });

  it('is empty without a health object', () => {
    expect(healthRows(null)).toEqual([]);
  });
});
