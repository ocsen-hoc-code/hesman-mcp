import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from '../../../src/indexing/file-watcher';
import { WorkerPool } from '../../../src/indexing/worker-pool';
import { SqliteStore } from '../../../src/stores/sqlite';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'hesman-fw-test');
const DATA_DIR = join(TEST_DIR, '.hesman');

describe('FileWatcher', () => {
  let store: SqliteStore;
  let pool: WorkerPool;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(DATA_DIR, { recursive: true });
    // Create a .ts file to watch
    writeFileSync(join(TEST_DIR, 'test.ts'), 'export function hello() { return "world"; }');
    store = new SqliteStore(DATA_DIR);
    store.open();
    pool = new WorkerPool(1);
  });

  afterEach(async () => {
    await pool.terminate();
    store.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('creates and starts a file watcher', async () => {
    const watcher = new FileWatcher({
      projectRoot: TEST_DIR,
      ignore: [],
      store,
      pool,
    });
    await watcher.start();
    expect(watcher.pendingCount).toBe(0);
    await watcher.stop();
  });

  it('stop waits for pending tasks', async () => {
    const watcher = new FileWatcher({
      projectRoot: TEST_DIR,
      ignore: [],
      store,
      pool,
    });
    await watcher.start();
    await watcher.stop();
    expect(watcher.pendingCount).toBe(0);
  });

  it('does not watch node_modules or .git', async () => {
    mkdirSync(join(TEST_DIR, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'node_modules', 'pkg', 'index.ts'), 'export const x = 1;');
    mkdirSync(join(TEST_DIR, '.git'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.git', 'config'), '...');

    const watcher = new FileWatcher({
      projectRoot: TEST_DIR,
      ignore: [],
      store,
      pool,
    });
    await watcher.start();

    // Change a file in node_modules — should be ignored
    writeFileSync(join(TEST_DIR, 'node_modules', 'pkg', 'index.ts'), 'export const x = 2;');

    // Wait for chokidar to fire
    await new Promise(r => setTimeout(r, 300));
    expect(watcher.pendingCount).toBe(0);

    await watcher.stop();
  });
});
