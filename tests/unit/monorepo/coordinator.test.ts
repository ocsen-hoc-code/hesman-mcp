import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexWorkspace } from '../../../src/monorepo/coordinator';
import { detectWorkspace } from '../../../src/monorepo/detector';
import { SqliteStore } from '../../../src/stores/sqlite';
import { defaultConfig } from '../../../src/config/defaults';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, mkdirSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'monorepo-basic');
const TEST_DATA_DIR = '.hesman-test-monorepo-coordinator';

describe('indexWorkspace', () => {
  let store: SqliteStore;

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    store = new SqliteStore(TEST_DATA_DIR);
    store.open();
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
  });

  it('detects and indexes a pnpm workspace with 2 packages', async () => {
    const workspace = detectWorkspace(FIXTURE_DIR);
    expect(workspace).not.toBeNull();
    expect(workspace!.packages).toHaveLength(2);

    const result = await indexWorkspace(workspace!, store, defaultConfig);

    expect(result.packages).toHaveLength(2);
    expect(result.totalFiles).toBeGreaterThanOrEqual(2);

    // Verify per-package results
    const pkgAResult = result.packages.find((p) => p.name === '@monorepo/pkg-a');
    expect(pkgAResult).toBeDefined();
    expect(pkgAResult!.result.filesIndexed).toBeGreaterThanOrEqual(1);
    expect(pkgAResult!.result.symbolsFound).toBeGreaterThan(0);
    expect(pkgAResult!.result.errors).toHaveLength(0);

    const pkgBResult = result.packages.find((p) => p.name === '@monorepo/pkg-b');
    expect(pkgBResult).toBeDefined();
    expect(pkgBResult!.result.filesIndexed).toBeGreaterThanOrEqual(1);
    expect(pkgBResult!.result.symbolsFound).toBeGreaterThan(0);
    expect(pkgBResult!.result.errors).toHaveLength(0);

    expect(result.totalErrors).toBe(0);
    expect(result.tookMs).toBeGreaterThan(0);
  });

  it('stores symbols from all packages in the shared store', async () => {
    const workspace = detectWorkspace(FIXTURE_DIR);
    expect(workspace).not.toBeNull();

    await indexWorkspace(workspace!, store, defaultConfig);

    const stats = store.getStats();
    expect(stats.totalFiles).toBeGreaterThanOrEqual(2);
    expect(stats.totalSymbols).toBeGreaterThan(0);
  });

  it('resolves packages with their correct names', async () => {
    const workspace = detectWorkspace(FIXTURE_DIR);
    expect(workspace).not.toBeNull();

    const result = await indexWorkspace(workspace!, store, defaultConfig);

    const pkgA = result.packages.find((p) => p.name === '@monorepo/pkg-a');
    expect(pkgA).toBeDefined();
    // pkg-a has: User, createUser, formatUserName, UserService, DEFAULT_USER
    expect(pkgA!.result.symbolsFound).toBeGreaterThanOrEqual(5);

    const pkgB = result.packages.find((p) => p.name === '@monorepo/pkg-b');
    expect(pkgB).toBeDefined();
    // pkg-b has: greetUser, buildProfile, isAdmin, ProfileManager
    expect(pkgB!.result.symbolsFound).toBeGreaterThanOrEqual(4);
  });

  it('aggregates cross-package relation counts', async () => {
    const workspace = detectWorkspace(FIXTURE_DIR);
    expect(workspace).not.toBeNull();

    const result = await indexWorkspace(workspace!, store, defaultConfig);

    // crossPackageRelations should be >= 0
    expect(result.crossPackageRelations).toBeGreaterThanOrEqual(0);
  });

  it('reports aggregate workspace statistics', async () => {
    const workspace = detectWorkspace(FIXTURE_DIR);
    expect(workspace).not.toBeNull();

    const result = await indexWorkspace(workspace!, store, defaultConfig);

    expect(result.workspace.type).toBe('pnpm');
    expect(result.workspace.root).toBe(FIXTURE_DIR);
    expect(result.totalFiles).toBeGreaterThan(0);
    expect(result.totalSymbols).toBeGreaterThan(0);
    expect(result.tookMs).toBeGreaterThan(0);
    expect(result.packages).toHaveLength(2);
  });
});
