import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FSWatcher } from 'chokidar';
import { FileWatcher } from '../../../src/indexing/file-watcher';
import { WorkerPool } from '../../../src/indexing/worker-pool';
import { SqliteStore } from '../../../src/stores/sqlite';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

// A fresh directory per test: a fixed path is shared by every checkout that
// runs this suite at the same time on one machine.
let TEST_DIR: string;
let DATA_DIR: string;

describe('FileWatcher', () => {
  let store: SqliteStore;
  let pool: WorkerPool;

  beforeEach(() => {
    TEST_DIR = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-fw-test-')));
    DATA_DIR = join(TEST_DIR, '.hesman');
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

// Creating symlinks on Windows needs Developer Mode or admin rights, so this
// test only runs on POSIX platforms.
const SYMLINKS_UNSUPPORTED = process.platform === 'win32';

describe('FileWatcher symlink safety', () => {
  let projectDir: string;
  let outsideDir: string;
  let dataDir: string;
  let store: SqliteStore;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-fw-symlink-')));
    outsideDir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-fw-outside-')));
    dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-fw-data-')));
    writeFileSync(join(projectDir, 'real.ts'), 'export const real = 1;\n');
    writeFileSync(join(outsideDir, 'secret.ts'), 'export const secret = 1;\n');
    if (!SYMLINKS_UNSUPPORTED) {
      symlinkSync(outsideDir, join(projectDir, 'outside'), 'dir');
    }
    store = new SqliteStore(dataDir);
    store.open();
  });

  afterEach(() => {
    store.close();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it.skipIf(SYMLINKS_UNSUPPORTED)(
    'does not follow a symlinked directory that points outside the project',
    async () => {
      const dispatch = vi.fn(async (tasks: Array<{ filePath: string }>) =>
        tasks.map((t) => ({ filePath: t.filePath, symbols: [], relations: [] })),
      );
      const pool = { dispatch } as unknown as WorkerPool;
      const watcher = new FileWatcher({ projectRoot: projectDir, ignore: [], store, pool });
      await watcher.start();

      const inner = (watcher as unknown as { watcher: FSWatcher }).watcher;
      await new Promise<void>((r) => inner.once('ready', () => r()));

      // Edit the file behind the symlink, then a real project file as a
      // positive control proving that change events are being delivered.
      writeFileSync(join(outsideDir, 'secret.ts'), 'export const secret = 2;\n');
      writeFileSync(join(projectDir, 'real.ts'), 'export const real = 2;\n');

      const dispatchedPaths = (): string[] =>
        dispatch.mock.calls.flatMap(([tasks]) => tasks.map((t) => t.filePath));

      const deadline = Date.now() + 5_000;
      while (!dispatchedPaths().includes(join(projectDir, 'real.ts')) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      // Give any event from the symlinked directory time to arrive as well.
      await new Promise((r) => setTimeout(r, 500));
      await watcher.stop();

      expect(dispatchedPaths()).toContain(join(projectDir, 'real.ts'));
      expect(dispatchedPaths().filter((p) => p.includes(`${sep}outside${sep}`))).toEqual([]);
    },
    15_000,
  );
});
