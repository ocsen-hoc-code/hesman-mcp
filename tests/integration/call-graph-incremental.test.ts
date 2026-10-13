import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexProject } from '../../src/indexing/index-coordinator';
import { FileWatcher } from '../../src/indexing/file-watcher';
import { WorkerPool } from '../../src/indexing/worker-pool';
import { SqliteStore } from '../../src/stores/sqlite';
import { defaultConfig } from '../../src/config/defaults';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '..', 'fixtures', 'polyglot-basic');
const config = { ...defaultConfig, watchMode: false };

function symbol(store: SqliteStore, name: string) {
  const [sym] = store.getSymbolsByName(name);
  if (!sym) throw new Error(`symbol ${name} not indexed`);
  return sym;
}

function callerNames(store: SqliteStore, name: string): string[] {
  return store.getCallers(symbol(store, name).id).map((c) => c.name);
}

/** Moves GoGreet down by prepending blank lines after the package clause. */
function shiftGreet(project: string): void {
  const file = join(project, 'go', 'greet.go');
  writeFileSync(file, readFileSync(file, 'utf-8').replace('package main\n', 'package main\n\n\n\n\n'));
}

describe('call graph across files and incremental re-indexing', () => {
  let project: string;
  let store: SqliteStore;

  beforeEach(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-callgraph-')));
    cpSync(FIXTURE, project, { recursive: true });
    store = new SqliteStore(join(project, '.hesman'));
    store.open();
  });

  afterEach(() => {
    store.close();
    rmSync(project, { recursive: true, force: true });
  });

  it('links callers across files and never to a declaration (single-threaded path)', async () => {
    await indexProject(project, store, config);
    expect(callerNames(store, 'GoGreet')).toEqual(['main']);
    expect(callerNames(store, 'tsGreet')).toEqual(['tsMain']);
    expect(callerNames(store, 'py_greet')).toEqual(['py_main']);
    for (const name of ['GoGreet', 'GoFormatName', 'main', 'tsGreet', 'tsFormatName', 'tsMain', 'py_greet', 'py_format_name', 'py_main']) {
      expect(callerNames(store, name)).not.toContain(name);
    }
  });

  it('keeps the cross-file caller after re-indexing only the callee file (indexProject)', async () => {
    await indexProject(project, store, config);
    const before = symbol(store, 'GoGreet');

    shiftGreet(project);
    const result = await indexProject(project, store, config);
    expect(result.filesIndexed).toBe(1);

    const after = symbol(store, 'GoGreet');
    expect(after.start_line).toBe(before.start_line + 4);
    expect(after.id).not.toBe(before.id);
    expect(callerNames(store, 'GoGreet')).toEqual(['main']);
  });

  it('keeps the cross-file caller after re-indexing only the callee file (worker pool + watcher)', async () => {
    const pool = new WorkerPool(1);
    try {
      await indexProject(project, store, config, undefined, pool);
      expect(callerNames(store, 'GoGreet')).toEqual(['main']);

      shiftGreet(project);
      const watcher = new FileWatcher({ projectRoot: project, ignore: [], store, pool });
      await (watcher as unknown as { handleChange(f: string): Promise<void> }).handleChange(join(project, 'go', 'greet.go'));

      expect(symbol(store, 'GoGreet').start_line).toBe(18);
      expect(callerNames(store, 'GoGreet')).toEqual(['main']);
      expect(store.getCallees(symbol(store, 'GoGreet').id).map((c) => c.name)).toEqual(['GoFormatName']);
    } finally {
      await pool.terminate();
    }
  });

  it('drops the caller link when the callee is deleted and restores it when re-added', async () => {
    const pool = new WorkerPool(1);
    try {
      await indexProject(project, store, config, undefined, pool);
      const greet = join(project, 'go', 'greet.go');
      const original = readFileSync(greet, 'utf-8');
      const watcher = new FileWatcher({ projectRoot: project, ignore: [], store, pool });
      const internal = watcher as unknown as { handleDelete(f: string): void; handleChange(f: string): Promise<void> };

      rmSync(greet);
      internal.handleDelete(greet);
      expect(store.getCallees(symbol(store, 'main').id)).toEqual([]);

      writeFileSync(greet, original);
      await internal.handleChange(greet);
      expect(callerNames(store, 'GoGreet')).toEqual(['main']);
    } finally {
      await pool.terminate();
    }
  });
});
