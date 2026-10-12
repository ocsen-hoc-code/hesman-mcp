/**
 * The graph queries on an index the size of a large project: 40,000 symbols,
 * 120,000 relations and one symbol that 20,000 others call. Results must stay
 * within their limits, say when they were cut, and come back quickly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INDEX_SCHEMA_VERSION, SqliteStore, type RelationRow, type SymbolRow } from '../../../src/stores/sqlite';
import { fileGraph, neighborhood, searchSymbols } from '../../../src/ui/server/graph';
import { openReadOnlyIndex, type ReadOnlyIndex } from '../../../src/ui/server/index-reader';

const SYMBOLS = 40_000;
const FILES = 2_000;
const HUB_CALLERS = 20_000;
/** Generous: the queries take a few milliseconds; this only catches a scan that grows with the project. */
const BUDGET_MS = 500;

describe('dashboard graph queries on a large index', () => {
  let dir: string;
  let root: string;
  let index: ReadOnlyIndex;

  const timed = <T>(fn: () => T): { value: T; ms: number } => {
    const start = performance.now();
    const value = fn();
    const ms = performance.now() - start;
    if (process.env.HESMAN_UI_TIMINGS) console.error(`graph query took ${ms.toFixed(1)} ms`);
    return { value, ms };
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-ui-scale-'));
    root = join(dir, 'project');
    const dataDir = join(root, '.hesman');
    const store = new SqliteStore(dataDir);
    store.open();

    const file = (i: number): string => join(root, 'src', `dir${i % 50}`, `file${i % FILES}.ts`);
    const symbols: SymbolRow[] = [];
    for (let i = 0; i < SYMBOLS; i++) {
      symbols.push({
        id: `sym-${i}`,
        name: i === 0 ? 'hubTarget' : `fn${i}Worker`,
        kind: 'function',
        file_path: file(i),
        start_line: 1 + (i % 400),
        end_line: 3 + (i % 400),
        start_col: 0,
        end_col: 0,
        signature: null,
        doc_comment: null,
        parent_id: null,
        language: 'typescript',
        is_exported: 1,
        updated_at: 0,
      });
    }
    store.upsertSymbols(symbols);

    const relations: RelationRow[] = [];
    const call = (from: number, to: number): void => {
      relations.push({ from_id: `sym-${from}`, to_id: `sym-${to}`, kind: 'calls', file_path: file(from), line: 2, col: 0 });
    };
    for (let i = 1; i <= HUB_CALLERS; i++) call(i, 0);
    for (let i = 1; i < SYMBOLS; i++) {
      call(i, (i * 7 + 1) % SYMBOLS);
      call(i, (i * 13 + 5) % SYMBOLS);
      if (i % 2 === 0) call(i, (i * 31 + 11) % SYMBOLS);
    }
    store.upsertRelations(relations);
    store.setIndexSchemaVersion(INDEX_SCHEMA_VERSION);
    store.close();

    index = openReadOnlyIndex(dataDir);
  }, 120_000);

  afterAll(() => {
    index?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('search returns at most the limit', () => {
    const { value, ms } = timed(() => searchSymbols(index.db, root, { q: 'worker', limit: 30 }));
    expect(value).toHaveLength(30);
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(searchSymbols(index.db, root, { q: 'hubtarget', limit: 30 })[0]).toMatchObject({ id: 'sym-0', filePath: 'src/dir0/file0.ts' });
  });

  it('the neighborhood of a symbol with 20,000 callers is cut at the limit and flagged', () => {
    const { value, ms } = timed(() => neighborhood(index.db, root, { symbolId: 'sym-0', depth: 1, limit: 80 }));
    expect(value?.nodes).toHaveLength(80);
    expect(value?.truncated).toBe(true);
    expect(value?.edges.length).toBeLessThanOrEqual(800);
    const ids = new Set(value?.nodes.map((n) => n.id));
    expect(value?.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('a depth-3 neighborhood at the maximum limit stays bounded', () => {
    const { value, ms } = timed(() => neighborhood(index.db, root, { symbolId: 'sym-12345', depth: 3, limit: 500 }));
    expect(value?.nodes.length).toBeLessThanOrEqual(500);
    expect(value?.edges.length).toBeLessThanOrEqual(5000);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('the file graph returns at most the limit of files, flags the cut, and only links returned files', () => {
    const { value, ms } = timed(() => fileGraph(index.db, root, { limit: 200 }));
    expect(value.nodes).toHaveLength(200);
    expect(value.truncated).toBe(true);
    expect(value.edges.length).toBeLessThanOrEqual(2000);
    const ids = new Set(value.nodes.map((n) => n.id));
    expect(value.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('refuses writes through the store it hands to the tools', () => {
    expect(() => index.store.clearSymbols(join(root, 'src', 'dir0', 'file0.ts'))).toThrow(/readonly/i);
  });
});
