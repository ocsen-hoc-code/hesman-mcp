import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deterministic, offline embeddings: the test is about which documents exist.
vi.mock('../../src/stores/embedding.js', () => ({
  embedBatch: async (texts: string[]) => texts.map(() => Float32Array.from({ length: 384 }, () => 1)),
  embedText: async () => Float32Array.from({ length: 384 }, () => 1),
  isEmbeddingReady: () => true,
  initEmbedding: async () => undefined,
}));

const { indexProject } = await import('../../src/indexing/index-coordinator.js');
const { SqliteStore, INDEX_SCHEMA_VERSION } = await import('../../src/stores/sqlite.js');
const { ZVecStore } = await import('../../src/stores/zvec.js');
const { defaultConfig } = await import('../../src/config/defaults.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'polyglot-basic');
const LEGACY_ID = 'legacy-py-greet';
const QUERY = Float32Array.from({ length: 384 }, () => 1);

describe('ZVec documents of a pre-M0-14 index first reopened without ZVec', () => {
  let root: string;
  let dataDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hesman-zvec-schema-'));
    cpSync(FIXTURE_DIR, root, { recursive: true });
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-zvec-schema-data-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  const config = () => ({ ...defaultConfig, projectRoot: root, watchMode: false });

  /** Writes a legacy (no schema version, 0-based) SQLite row and its ZVec document. */
  function seedLegacyIndex(): void {
    const greetPy = join(root, 'py', 'greet.py');
    const store = new SqliteStore(dataDir);
    store.open();
    const zvec = new ZVecStore(dataDir);
    zvec.open();
    try {
      store.upsertSymbols([{
        id: LEGACY_ID, name: 'py_greet', kind: 'function', file_path: greetPy,
        start_line: 4, end_line: 5, start_col: 0, end_col: 0, signature: null,
        doc_comment: null, parent_id: null, language: 'python', is_exported: 0, updated_at: 1,
      }]);
      store.upsertFileHash(greetPy, createHash('sha256').update(readFileSync(greetPy, 'utf-8')).digest('hex'));
      zvec.upsertDocs([{
        symbolId: LEGACY_ID, name: 'py_greet', kind: 'function', filePath: greetPy,
        startLine: 4, endLine: 5, signature: null, code: 'def py_greet(name):', docComment: null, language: 'python',
      }], [QUERY]);
      expect(store.getIndexSchemaVersion()).toBe(0);
      expect(zvec.search({ queryVector: QUERY, topK: 100 }).map((d) => d.symbolId)).toContain(LEGACY_ID);
    } finally {
      zvec.close();
      store.close();
    }
  }

  it('clears the stale ZVec documents on the first semantic run', async () => {
    seedLegacyIndex();

    // Run 1: no ZVec (CLI `index` or `--no-semantic`).
    const store = new SqliteStore(dataDir);
    store.open();
    try {
      await indexProject(root, store, config());
      expect(store.getIndexSchemaVersion()).toBe(INDEX_SCHEMA_VERSION);
      expect(store.getSymbolById(LEGACY_ID)).toBeUndefined();
    } finally {
      store.close();
    }

    // Run 2: ZVec enabled.
    const store2 = new SqliteStore(dataDir);
    store2.open();
    const zvec = new ZVecStore(dataDir);
    zvec.open();
    try {
      await indexProject(root, store2, config(), zvec);
      const ids = zvec.search({ queryVector: QUERY, topK: 100 }).map((d) => d.symbolId);
      expect(ids).not.toContain(LEGACY_ID);
      // Every current symbol has its vector again (files were re-embedded, not skipped).
      const current = store2.getSymbolsByName('py_greet');
      expect(current).toHaveLength(1);
      expect(ids).toContain(current[0].id);

      // Run 3: ZVec enabled, nothing changed — no further reset.
      const third = await indexProject(root, store2, config(), zvec);
      expect(third.filesIndexed).toBe(0);
    } finally {
      zvec.close();
      store2.close();
    }
  }, 30000);
});
