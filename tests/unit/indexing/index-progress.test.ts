import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexProject, IndexAbortedError } from '../../../src/indexing/index-coordinator.js';
import type { IndexProgress } from '../../../src/indexing/index-state.js';
import { WorkerPool } from '../../../src/indexing/worker-pool.js';
import { SqliteStore } from '../../../src/stores/sqlite.js';
import { defaultConfig } from '../../../src/config/defaults.js';

const FILE_COUNT = 450;

describe('indexProject progress and cancellation', () => {
  let root: string;
  let dataDir: string;
  let store: SqliteStore;
  let pool: WorkerPool | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hesman-progress-src-'));
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-progress-data-'));
    mkdirSync(join(root, 'src'));
    for (let i = 0; i < FILE_COUNT; i++) {
      writeFileSync(
        join(root, 'src', `mod${i}.ts`),
        `export function fn${i}(): number {\n  return ${i};\n}\n\n` +
          `export function use${i}(): number {\n  return fn${i}();\n}\n`,
      );
    }
    store = new SqliteStore(dataDir);
    store.open();
  });

  afterEach(async () => {
    await pool?.terminate(true);
    pool = undefined;
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  function expectMonotonic(events: IndexProgress[]): void {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].filesDone).toBeGreaterThanOrEqual(events[i - 1].filesDone);
    }
  }

  it('reports increasing progress through the worker pool path', async () => {
    pool = new WorkerPool(2);
    const events: IndexProgress[] = [];
    const result = await indexProject(root, store, defaultConfig, undefined, pool, {
      onProgress: (p) => events.push({ ...p }),
    });

    expect(result.filesIndexed).toBe(FILE_COUNT);
    expect(events[0]).toEqual({ phase: 'scanning', filesDone: 0, filesTotal: 0 });
    const indexing = events.filter((e) => e.phase === 'indexing');
    expect(indexing.every((e) => e.filesTotal === FILE_COUNT)).toBe(true);
    // Several intermediate steps, not a single jump from 0 to the total.
    expect(new Set(indexing.map((e) => e.filesDone)).size).toBeGreaterThan(2);
    expectMonotonic(events);
    expect(events[events.length - 1]).toEqual({ phase: 'resolving', filesDone: FILE_COUNT, filesTotal: FILE_COUNT });
  });

  it('counts unchanged files as done on an incremental run', async () => {
    pool = new WorkerPool(2);
    await indexProject(root, store, defaultConfig, undefined, pool);
    const events: IndexProgress[] = [];
    const result = await indexProject(root, store, defaultConfig, undefined, pool, {
      onProgress: (p) => events.push({ ...p }),
    });
    expect(result.filesIndexed).toBe(0);
    expect(events[events.length - 1]).toMatchObject({ filesDone: FILE_COUNT, filesTotal: FILE_COUNT });
  });

  it('reports increasing progress on the single-threaded path', async () => {
    const events: IndexProgress[] = [];
    await indexProject(root, store, defaultConfig, undefined, undefined, {
      onProgress: (p) => events.push({ ...p }),
    });
    const indexing = events.filter((e) => e.phase === 'indexing');
    expect(new Set(indexing.map((e) => e.filesDone)).size).toBeGreaterThan(2);
    expectMonotonic(events);
    expect(events[events.length - 1]).toMatchObject({ filesDone: FILE_COUNT, filesTotal: FILE_COUNT });
  });

  it('lets other work run on the event loop while it writes results', async () => {
    pool = new WorkerPool(2);
    // Timers that fire while files are already partly written prove the write
    // loop yields; a loop that never yields only lets timers run before the
    // first row or after the last one.
    let ticksMidWrite = 0;
    const timer = setInterval(() => {
      const files = store.getStats().totalFiles;
      if (files > 0 && files < FILE_COUNT) ticksMidWrite++;
    }, 1);
    try {
      await indexProject(root, store, defaultConfig, undefined, pool);
    } finally {
      clearInterval(timer);
    }
    expect(ticksMidWrite).toBeGreaterThan(0);
  });

  it('stops with IndexAbortedError when the signal aborts mid-run', async () => {
    pool = new WorkerPool(2);
    const controller = new AbortController();
    const run = indexProject(root, store, defaultConfig, undefined, pool, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'indexing' && p.filesDone > 0) controller.abort();
      },
    });
    await expect(run).rejects.toBeInstanceOf(IndexAbortedError);
    expect(store.getStats().totalFiles).toBeLessThan(FILE_COUNT);
  });

  it('links the calls of the files it stored before an abort', async () => {
    pool = new WorkerPool(2);
    const controller = new AbortController();
    const run = indexProject(root, store, defaultConfig, undefined, pool, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'indexing' && p.filesDone >= 10) controller.abort();
      },
    });
    await expect(run).rejects.toBeInstanceOf(IndexAbortedError);

    // Stored files keep their hash, so the next run skips them: their calls
    // must already be linked or they would stay unresolved forever.
    let storedCallers = 0;
    for (let i = 0; i < FILE_COUNT; i++) {
      const file = join(root, 'src', `mod${i}.ts`);
      if (!store.getFileHash(file)) continue;
      const caller = store.getSymbolsByFile(file).find((s) => s.name === `use${i}`);
      expect(caller).toBeDefined();
      expect(store.getCallees(caller!.id).map((c) => c.name)).toContain(`fn${i}`);
      storedCallers++;
    }
    expect(storedCallers).toBeGreaterThanOrEqual(10);
    expect(storedCallers).toBeLessThan(FILE_COUNT);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      indexProject(root, store, defaultConfig, undefined, undefined, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(IndexAbortedError);
    expect(store.getStats().totalFiles).toBe(0);
  });
});
