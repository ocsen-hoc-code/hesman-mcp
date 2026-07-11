import { describe, it, expect, beforeAll } from 'vitest';
import { WorkerPool } from '../../../src/indexing/worker-pool';
import { initParser } from '../../../src/parsers/core';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'ts-basic');

describe('WorkerPool', () => {
  beforeAll(async () => {
    await initParser(tsProfile);
  });

  it('creates pool with given size', () => {
    const pool = new WorkerPool(2);
    expect(pool.activeCount).toBe(0);
    expect(pool.pendingCount).toBe(0);
    pool.terminate();
  });

  it('creates pool with auto size (0)', () => {
    const pool = new WorkerPool(0);
    // Should create at least 1 worker
    expect(pool).toBeDefined();
    pool.terminate();
  });

  it('dispatches single task and gets result', async () => {
    const pool = new WorkerPool(2);
    const tasks = [{
      filePath: resolve(FIXTURE_DIR, 'src', 'index.ts'),
      language: 'typescript',
    }];

    const results = await pool.dispatch(tasks);
    expect(results).toHaveLength(1);
    expect(results[0].symbols.length).toBeGreaterThan(0);
    expect(results[0].contentHash).toBeTruthy();
    expect(results[0].relations).toBeDefined();

    await pool.terminate();
  });

  it('dispatches multiple tasks and gets all results', async () => {
    const pool = new WorkerPool(2);
    const tasks = [
      { filePath: resolve(FIXTURE_DIR, 'src', 'index.ts'), language: 'typescript' },
      { filePath: resolve(FIXTURE_DIR, 'src', 'utils.ts'), language: 'typescript' },
    ];

    const results = await pool.dispatch(tasks);
    expect(results).toHaveLength(2);
    expect(results[0].symbols.length).toBeGreaterThan(0);
    expect(results[1].symbols.length).toBeGreaterThan(0);

    await pool.terminate();
  });

  it('rejects new tasks after pause()', async () => {
    const pool = new WorkerPool(2);
    pool.pause();
    await expect(pool.dispatch([{
      filePath: resolve(FIXTURE_DIR, 'src', 'index.ts'),
      language: 'typescript',
    }])).rejects.toThrow();

    await pool.terminate();
  });

  it('drain waits for in-progress tasks', async () => {
    const pool = new WorkerPool(2);

    // Dispatch a task
    const promise = pool.dispatch([{
      filePath: resolve(FIXTURE_DIR, 'src', 'index.ts'),
      language: 'typescript',
    }]);

    // Drain should resolve after task completes
    await pool.drain();
    const results = await promise;
    expect(results).toHaveLength(1);

    await pool.terminate();
  });

  it('terminate force kills workers immediately', async () => {
    const pool = new WorkerPool(2);
    await pool.terminate(true);
    // Should not throw
  });
});
