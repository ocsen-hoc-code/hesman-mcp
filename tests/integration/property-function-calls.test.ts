/**
 * M1-08 item 6: a function assigned to an object key or property is not a
 * project-wide call target just because its name is unique. Checked through
 * the real indexing pipeline, including an incremental re-index.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexProject } from '../../src/indexing/index-coordinator';
import { WorkerPool } from '../../src/indexing/worker-pool';
import { SqliteStore } from '../../src/stores/sqlite';
import { defaultConfig } from '../../src/config/defaults';

const config = { ...defaultConfig, watchMode: false };

const HANDLERS = [
  'export const handlers = {',
  '  onClick: () => 1,',
  '};',
  'handlers.onHover = function () { return 2; };',
  'export function fire(): number {',
  '  return handlers.onClick() + handlers.onHover();',
  '}',
  'export function plain(): number { return 3; }',
  '',
].join('\n');

/** Calls the same names from another directory, without importing anything. */
const FAR = [
  'export function far(o: { onClick: () => number; onHover: () => number }): number {',
  '  return o.onClick() + o.onHover() + plain();',
  '}',
  '',
].join('\n');

function symbol(store: SqliteStore, name: string) {
  const [sym] = store.getSymbolsByName(name);
  if (!sym) throw new Error(`symbol ${name} not indexed`);
  return sym;
}

const callees = (store: SqliteStore, name: string): string[] =>
  store.getCallees(symbol(store, name).id).map((c) => c.name).sort();

describe('call resolution to property-assigned functions', () => {
  let project: string;
  let store: SqliteStore;

  beforeEach(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-propfn-')));
    mkdirSync(join(project, 'ui'));
    mkdirSync(join(project, 'other'));
    writeFileSync(join(project, 'package.json'), '{}');
    writeFileSync(join(project, 'ui', 'handlers.ts'), HANDLERS);
    writeFileSync(join(project, 'other', 'far.ts'), FAR);
    store = new SqliteStore(join(project, '.hesman'));
    store.open();
  });

  afterEach(() => {
    store.close();
    rmSync(project, { recursive: true, force: true });
  });

  const expectLinks = (): void => {
    // Same file: the property-assigned functions are linked.
    expect(callees(store, 'fire')).toEqual(['onClick', 'onHover']);
    // Another file: only the declared function is linked, although every name is unique in the project.
    expect(callees(store, 'far')).toEqual(['plain']);
  };

  it('links them in their own file only (single-threaded path)', async () => {
    await indexProject(project, store, config);
    expectLinks();
  });

  it('links them in their own file only (worker pool)', async () => {
    const pool = new WorkerPool(1);
    try {
      await indexProject(project, store, config, undefined, pool);
      expectLinks();
    } finally {
      await pool.terminate();
    }
  });

  it('keeps the rule after re-indexing only the file that defines them', async () => {
    await indexProject(project, store, config);
    const file = join(project, 'ui', 'handlers.ts');
    writeFileSync(file, `\n\n${readFileSync(file, 'utf-8')}`);
    const result = await indexProject(project, store, config);
    expect(result.filesIndexed).toBe(1);
    expect(symbol(store, 'onClick').start_line).toBe(4);
    expectLinks();
  });

  it('keeps the rule after re-indexing only the calling file', async () => {
    await indexProject(project, store, config);
    const file = join(project, 'other', 'far.ts');
    writeFileSync(file, `\n${readFileSync(file, 'utf-8')}`);
    const result = await indexProject(project, store, config);
    expect(result.filesIndexed).toBe(1);
    expectLinks();
  });
});
