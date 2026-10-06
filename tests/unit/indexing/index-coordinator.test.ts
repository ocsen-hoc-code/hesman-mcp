import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexProject } from '../../../src/indexing/index-coordinator';
import { SqliteStore } from '../../../src/stores/sqlite';
import { defaultConfig } from '../../../src/config/defaults';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'ts-basic');

describe('indexProject', () => {
  let store: SqliteStore;
  // A unique data dir per test: a fixed directory in the cwd collided when two
  // test runs shared a checkout, so one run deleted the other's SQLite file.
  let testDataDir: string;

  beforeEach(() => {
    testDataDir = mkdtempSync(join(tmpdir(), 'hesman-test-coordinator-'));
    store = new SqliteStore(testDataDir);
    store.open();
  });

  afterEach(() => {
    store.close();
    rmSync(testDataDir, { recursive: true, force: true });
  });

  it('indexes a TypeScript project and stores symbols', async () => {
    const result = await indexProject(FIXTURE_DIR, store, defaultConfig);
    expect(result.filesIndexed).toBeGreaterThanOrEqual(2);
    expect(result.symbolsFound).toBeGreaterThan(5);
    expect(result.errors).toHaveLength(0);
    expect(result.tookMs).toBeGreaterThanOrEqual(0); // Date.now() has 1 ms resolution
  });

  it('stores symbols in SQLite after indexing', async () => {
    await indexProject(FIXTURE_DIR, store, defaultConfig);
    const stats = store.getStats();
    expect(stats.totalSymbols).toBeGreaterThan(0);
    expect(stats.totalFiles).toBeGreaterThanOrEqual(2);
  });

  it('updates file hashes after indexing', async () => {
    await indexProject(FIXTURE_DIR, store, defaultConfig);
    const hash = store.getFileHash(resolve(FIXTURE_DIR, 'src/utils.ts'));
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64); // SHA256 hex
  });

  it('skip files that have not changed (incremental)', async () => {
    // First index
    await indexProject(FIXTURE_DIR, store, defaultConfig);
    const firstStats = store.getStats();

    // Second index — should be incremental (skip unchanged)
    const result = await indexProject(FIXTURE_DIR, store, defaultConfig);
    // Files are unchanged, so filesIndexed should be 0 (all skipped)
    expect(result.filesIndexed).toBe(0);

    // Stats should remain the same (upsert with same data is stable)
    const secondStats = store.getStats();
    expect(secondStats.totalSymbols).toBe(firstStats.totalSymbols);
  });
});
