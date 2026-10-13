import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { indexProject } from '../../src/indexing/index-coordinator';
import { FileWatcher } from '../../src/indexing/file-watcher';
import { WorkerPool } from '../../src/indexing/worker-pool';
import { SqliteStore } from '../../src/stores/sqlite';
import { defaultConfig } from '../../src/config/defaults';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLYGLOT_FIXTURE = resolve(__dirname, '..', 'fixtures', 'polyglot-basic');

/** Polls `check` until it returns true or the timeout elapses. */
async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

describe('language registry — worker pool indexes every registered language', () => {
  let workDir: string;
  let projectDir: string;
  let store: SqliteStore;
  let pool: WorkerPool;

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'hesman-langreg-'));
    projectDir = join(workDir, 'project');
    cpSync(POLYGLOT_FIXTURE, projectDir, { recursive: true });
    store = new SqliteStore(join(workDir, 'data'));
    store.open();
    pool = new WorkerPool(2);
  });

  afterAll(async () => {
    await pool?.terminate();
    store?.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('indexProject with a WorkerPool indexes TypeScript, Python and Go', async () => {
    const result = await indexProject(projectDir, store, { ...defaultConfig, watchMode: false }, undefined, pool);

    expect(result.errors).toEqual([]);
    expect(store.getSymbolsByName('tsGreet')).toHaveLength(1);
    expect(store.getSymbolsByName('py_greet')).toHaveLength(1);
    expect(store.getSymbolsByName('GoGreet')).toHaveLength(1);

    const languages = new Set(
      ['tsGreet', 'py_greet', 'GoGreet'].map((name) => store.getSymbolsByName(name)[0]?.language),
    );
    expect(languages).toEqual(new Set(['typescript', 'python', 'go']));
  }, 60000);

  it('re-indexes an edited .py file while the watcher runs', async () => {
    const watcher = new FileWatcher({ projectRoot: projectDir, ignore: [], store, pool });
    await watcher.start();
    try {
      // Give chokidar time to finish its initial scan before editing.
      await new Promise((r) => setTimeout(r, 500));

      const pyFile = join(projectDir, 'py', 'greet.py');
      const original = readFileSync(pyFile, 'utf-8');
      writeFileSync(pyFile, original + '\n\ndef py_watch_added(x: int) -> int:\n    return x\n');

      const found = await waitUntil(() => store.getSymbolsByName('py_watch_added').length === 1, 15000);
      expect(found).toBe(true);
      expect(store.getSymbolsByName('py_watch_added')[0].language).toBe('python');
    } finally {
      await watcher.stop();
    }
  }, 30000);
});
