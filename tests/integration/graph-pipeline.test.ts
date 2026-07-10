import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'ts-basic');
const TEST_DATA = resolve(FIXTURE_DIR, '.hesman-graph-test');

// Dynamic imports to avoid circular deps during test collection
async function setupStores() {
  const { indexProject } = await import('../../src/indexing/index-coordinator');
  const { SqliteStore } = await import('../../src/stores/sqlite');
  const { defaultConfig } = await import('../../src/config/defaults');

  const sqliteStore = new SqliteStore(TEST_DATA);
  sqliteStore.open();

  const result = await indexProject(FIXTURE_DIR, sqliteStore, defaultConfig);

  return { sqliteStore, result };
}

describe('graph pipeline integration', () => {
  beforeAll(() => {
    if (existsSync(TEST_DATA)) rmSync(TEST_DATA, { recursive: true });
    mkdirSync(TEST_DATA, { recursive: true });
  }, 60000);

  afterAll(() => {
    if (existsSync(TEST_DATA)) rmSync(TEST_DATA, { recursive: true });
  });

  it('indexes fixture project into relations', async () => {
    const { sqliteStore, result } = await setupStores();
    expect(result.filesIndexed).toBeGreaterThanOrEqual(2);
    expect(sqliteStore.getTotalRelations()).toBeGreaterThan(0);
    sqliteStore.close();
  }, 30000);

  it('getReferences returns references for formatGreeting (intra-file calls)', async () => {
    const { sqliteStore } = await setupStores();
    const symbols = sqliteStore.getSymbolsByName('formatGreeting');
    expect(symbols.length).toBeGreaterThan(0);

    const symbol = symbols[0];
    const refs = sqliteStore.getReferences(symbol.id);

    expect(refs.refs.length).toBeGreaterThan(0);
    expect(refs.totalCount).toBeGreaterThanOrEqual(refs.refs.length);

    // References should exist from index.ts (callers in the same file)
    const fileRefs = refs.refs.filter((r) => r.filePath.includes('index.ts'));
    expect(fileRefs.length).toBeGreaterThan(0);

    // All returned refs should have valid shapes
    for (const ref of refs.refs) {
      expect(ref).toHaveProperty('filePath');
      expect(ref).toHaveProperty('line');
      expect(ref).toHaveProperty('col');
      expect(ref).toHaveProperty('kind');
      expect(typeof ref.line).toBe('number');
    }

    sqliteStore.close();
  }, 30000);

  it('getCallers returns callers for formatGreeting (intra-file calls)', async () => {
    const { sqliteStore } = await setupStores();
    const symbols = sqliteStore.getSymbolsByName('formatGreeting');
    expect(symbols.length).toBeGreaterThan(0);

    const symbol = symbols[0];
    const callers = sqliteStore.getCallers(symbol.id, 1, 50);

    expect(callers.length).toBeGreaterThan(0);

    // main() calls formatGreeting() in the same file, so main should be a caller
    const mainCallers = callers.filter((c) => c.name === 'main');
    expect(mainCallers.length).toBeGreaterThan(0);

    // Verify caller result shape
    for (const caller of callers) {
      expect(caller).toHaveProperty('symbolId');
      expect(caller).toHaveProperty('name');
      expect(caller).toHaveProperty('kind');
      expect(caller).toHaveProperty('filePath');
      expect(caller).toHaveProperty('depth');
      expect(caller).toHaveProperty('callSite');
      expect(caller.callSite).toHaveProperty('filePath');
      expect(caller.callSite).toHaveProperty('line');
      expect(typeof caller.depth).toBe('number');
    }

    sqliteStore.close();
  }, 30000);

  it('getCallees returns callees for main symbol (intra-file calls)', async () => {
    const { sqliteStore } = await setupStores();
    const symbols = sqliteStore.getSymbolsByName('main');
    expect(symbols.length).toBeGreaterThan(0);

    const mainSymbol = symbols[0];
    const callees = sqliteStore.getCallees(mainSymbol.id, 1, 50);

    expect(callees.length).toBeGreaterThan(0);

    // main() calls formatGreeting() in the same file
    const calleeNames = callees.map((c) => c.name);
    expect(calleeNames).toContain('formatGreeting');

    // Verify callee result shape
    for (const callee of callees) {
      expect(callee).toHaveProperty('symbolId');
      expect(callee).toHaveProperty('name');
      expect(callee).toHaveProperty('kind');
      expect(callee).toHaveProperty('filePath');
      expect(callee).toHaveProperty('depth');
      expect(callee).toHaveProperty('callSite');
      expect(typeof callee.depth).toBe('number');
    }

    sqliteStore.close();
  }, 30000);

  it('second index run skips unchanged files, relations preserved', async () => {
    const { sqliteStore, result } = await setupStores();
    // Files unchanged — hashes match so nothing re-indexed
    expect(result.filesIndexed).toBe(0);

    // Relations from the first run should still be present
    expect(sqliteStore.getTotalRelations()).toBeGreaterThan(0);

    sqliteStore.close();
  }, 30000);
});
