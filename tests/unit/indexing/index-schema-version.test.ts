import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexProject } from '../../../src/indexing/index-coordinator';
import { INDEX_SCHEMA_VERSION, SqliteStore } from '../../../src/stores/sqlite';
import { defaultConfig } from '../../../src/config/defaults';
import type { ZVecStore } from '../../../src/stores/zvec';

// Embedding is not under test here; keep it deterministic and model-free.
vi.mock('../../../src/stores/embedding', () => ({
  embedBatch: async (texts: string[]) => texts.map(() => new Float32Array(384)),
}));

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'polyglot-basic');
const GREET_PY = join(FIXTURE_DIR, 'py', 'greet.py');

function fakeZvec(): ZVecStore & { clear: ReturnType<typeof vi.fn> } {
  return {
    clear: vi.fn(),
    deleteByFile: vi.fn(),
    upsertDocs: vi.fn(),
  } as unknown as ZVecStore & { clear: ReturnType<typeof vi.fn> };
}

/** Simulates an index written before M0-14: 0-based rows, matching file hash, no schema version. */
function seedLegacyIndex(store: SqliteStore): void {
  const sha = createHash('sha256').update(readFileSync(GREET_PY, 'utf-8')).digest('hex');
  store.upsertSymbols([{
    id: 'legacy-py-greet',
    name: 'py_greet',
    kind: 'function',
    file_path: GREET_PY,
    start_line: 4,
    end_line: 5,
    start_col: 0,
    end_col: 0,
    signature: null,
    doc_comment: null,
    parent_id: null,
    language: 'python',
    is_exported: 0,
    updated_at: 1,
  }]);
  store.upsertRelations([{ from_id: 'legacy-py-greet', to_id: 'x', kind: 'calls', file_path: GREET_PY, line: 5, col: 0 }]);
  store.upsertFileHash(GREET_PY, sha);
}

describe('index schema version (1-based lines)', () => {
  let dataDir: string;
  let store: SqliteStore;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-schema-version-'));
    store = new SqliteStore(dataDir);
    store.open();
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reports no schema version for an index created before versioning', () => {
    expect(store.getIndexSchemaVersion()).toBe(0);
    expect(INDEX_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('forces a full re-index of a legacy index even when file hashes match', async () => {
    seedLegacyIndex(store);
    const zvec = fakeZvec();

    await indexProject(FIXTURE_DIR, store, defaultConfig, zvec);

    expect(zvec.clear).toHaveBeenCalledTimes(1);
    expect(store.getSymbolById('legacy-py-greet')).toBeUndefined();
    const greet = store.getSymbolsByName('py_greet');
    expect(greet).toHaveLength(1);
    expect(greet[0].start_line).toBe(5);
    expect(store.getIndexSchemaVersion()).toBe(INDEX_SCHEMA_VERSION);
  });

  it('does not clear an index that is already at the current version', async () => {
    await indexProject(FIXTURE_DIR, store, defaultConfig);
    const zvec = fakeZvec();

    const second = await indexProject(FIXTURE_DIR, store, defaultConfig, zvec);

    expect(zvec.clear).not.toHaveBeenCalled();
    expect(second.filesIndexed).toBe(0);
  });

  it('keeps the schema version across reopen', async () => {
    await indexProject(FIXTURE_DIR, store, defaultConfig);
    store.close();
    store = new SqliteStore(dataDir);
    store.open();
    expect(store.getIndexSchemaVersion()).toBe(INDEX_SCHEMA_VERSION);
  });
});
