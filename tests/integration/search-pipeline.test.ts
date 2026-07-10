import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'ts-basic');
const TEST_DATA = resolve(FIXTURE_DIR, '.hesman-integration-test');

// Dynamic imports to avoid circular deps during test collection
async function setupStores() {
  const { indexProject } = await import('../../src/indexing/index-coordinator');
  const { SqliteStore } = await import('../../src/stores/sqlite');
  const { ZVecStore } = await import('../../src/stores/zvec');
  const { initEmbedding } = await import('../../src/stores/embedding');
  const { defaultConfig } = await import('../../src/config/defaults');

  const sqliteStore = new SqliteStore(TEST_DATA);
  sqliteStore.open();

  await initEmbedding('Xenova/all-MiniLM-L6-v2');
  const zvecStore = new ZVecStore(TEST_DATA);
  zvecStore.open();

  const result = await indexProject(FIXTURE_DIR, sqliteStore, defaultConfig, zvecStore);

  return { sqliteStore, zvecStore, result };
}

describe('search pipeline integration', () => {
  beforeAll(() => {
    if (existsSync(TEST_DATA)) rmSync(TEST_DATA, { recursive: true });
    mkdirSync(TEST_DATA, { recursive: true });
  }, 60000);

  afterAll(() => {
    if (existsSync(TEST_DATA)) rmSync(TEST_DATA, { recursive: true });
  });

  it('indexes fixture project into ZVec', async () => {
    const { zvecStore, sqliteStore, result } = await setupStores();
    expect(result.filesIndexed).toBeGreaterThanOrEqual(2);
    expect(zvecStore.stats().docCount).toBeGreaterThan(0);
    sqliteStore.close();
    zvecStore.close();
  }, 30000);

  it('semantic search finds relevant results', async () => {
    const { zvecStore, sqliteStore } = await setupStores();
    const { embedText } = await import('../../src/stores/embedding');

    // Search for "add two numbers" should find the `add` function
    const queryVec = await embedText('add two numbers together');
    const results = zvecStore.search({ queryVector: queryVec, topK: 5 });

    expect(results.length).toBeGreaterThan(0);
    // The `add` function should be in results
    const addResult = results.find(r => r.name === 'add');
    expect(addResult).toBeDefined();

    sqliteStore.close();
    zvecStore.close();
  }, 30000);

  it('second index run skips unchanged files', async () => {
    const { zvecStore, sqliteStore, result } = await setupStores();
    // Data from previous tests is still on disk; hashes match so nothing re-indexed
    expect(result.filesIndexed).toBe(0);

    sqliteStore.close();
    zvecStore.close();
  }, 30000);
});
