import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Deterministic, offline embeddings: the test is about which documents exist,
// not about ranking quality.
vi.mock('../../src/stores/embedding.js', () => ({
  embedBatch: async (texts: string[]) =>
    texts.map((_t, i) => Float32Array.from({ length: 384 }, (_v, j) => ((i + j) % 7) + 1)),
  embedText: async () => Float32Array.from({ length: 384 }, () => 1),
  isEmbeddingReady: () => true,
  initEmbedding: async () => undefined,
}));

const { indexProject } = await import('../../src/indexing/index-coordinator.js');
const { SqliteStore } = await import('../../src/stores/sqlite.js');
const { ZVecStore } = await import('../../src/stores/zvec.js');
const { WorkerPool } = await import('../../src/indexing/worker-pool.js');
const { defaultConfig } = await import('../../src/config/defaults.js');

const ORIGINAL = [
  'export function alpha(a: number): number {',
  '  return a + 1;',
  '}',
  '',
  'export function beta(b: number): number {',
  '  return b * 2;',
  '}',
  '',
].join('\n');

// Shifts every symbol down, so every symbol id (which includes the start row) changes.
const EDITED = ['// header comment', '// another line', '', ORIGINAL].join('\n');

describe("ZVec documents for a file under a directory containing '", () => {
  let root: string;
  let dataDir: string;
  let filePath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hesman-zvec-stale-'));
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-zvec-stale-data-'));
    const dir = join(root, "O'Brien", 'src');
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, 'a.ts');
    writeFileSync(filePath, ORIGINAL);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  const config = () => ({ ...defaultConfig, projectRoot: root, watchMode: false });

  async function assertNoStaleDocs(usePool: boolean): Promise<void> {
    const store = new SqliteStore(dataDir);
    store.open();
    const zvec = new ZVecStore(dataDir);
    zvec.open();
    const pool = usePool ? new WorkerPool(1) : undefined;
    try {
      await indexProject(root, store, config(), zvec, pool);
      const firstIds = store.getSymbolsByFile(filePath).map((s) => s.id).sort();
      expect(firstIds.length).toBeGreaterThan(0);
      expect(zvec.stats().docCount).toBe(firstIds.length);

      writeFileSync(filePath, EDITED);
      await indexProject(root, store, config(), zvec, pool);

      const currentIds = store.getSymbolsByFile(filePath).map((s) => s.id).sort();
      expect(currentIds).not.toEqual(firstIds);

      const docs = zvec.search({ queryVector: Float32Array.from({ length: 384 }, () => 1), topK: 100 });
      expect(docs.map((d) => d.symbolId).sort()).toEqual(currentIds);
      expect(zvec.stats().docCount).toBe(currentIds.length);
    } finally {
      if (pool) await pool.terminate();
      zvec.close();
      store.close();
    }
  }

  it('leaves no stale documents after an edit (single-threaded path)', async () => {
    await assertNoStaleDocs(false);
  }, 30000);

  it('leaves no stale documents after an edit (worker pool path)', async () => {
    await assertNoStaleDocs(true);
  }, 30000);
});
