import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexProject } from '../../../src/indexing/index-coordinator';
import { SqliteStore } from '../../../src/stores/sqlite';
import { defaultConfig } from '../../../src/config/defaults';
import { resolve } from 'node:path';
import { rmSync, mkdirSync, existsSync } from 'node:fs';

const FIXTURE_DIR = resolve(import.meta.dirname, '..', '..', 'fixtures', 'ts-basic');
const TEST_DATA_DIR = '.hesman-test-coordinator';

describe('indexProject', () => {
  let store: SqliteStore;

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    store = new SqliteStore(TEST_DATA_DIR);
    store.open();
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
  });

  it('indexes a TypeScript project and stores symbols', async () => {
    const result = await indexProject(FIXTURE_DIR, store, defaultConfig);
    expect(result.filesIndexed).toBeGreaterThanOrEqual(2);
    expect(result.symbolsFound).toBeGreaterThan(5);
    expect(result.errors).toHaveLength(0);
    expect(result.tookMs).toBeGreaterThan(0);
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
