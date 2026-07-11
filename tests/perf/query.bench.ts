import { bench, describe } from 'vitest';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { THRESHOLDS } from './thresholds';
import { SqliteStore, type SymbolRow } from '../../src/stores/sqlite';
import { ZVecStore, type SearchDoc } from '../../src/stores/zvec';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'ts-basic');
const SYMBOL_COUNT = 2000;

/** Make a synthetic SymbolRow */
function makeSymbol(i: number): SymbolRow {
  const name = i % 3 === 0
    ? `findMe_${i}`
    : i % 3 === 1
      ? `handler_${i}`
      : `util_${i}`;
  return {
    id: `sym_${i}`,
    name,
    kind: i % 4 === 0 ? 'function' : i % 4 === 1 ? 'class' : i % 4 === 2 ? 'variable' : 'interface',
    file_path: `src/module_${i % 10}.ts`,
    start_line: i * 3,
    end_line: i * 3 + 5,
    start_col: 0,
    end_col: 40,
    signature: name.endsWith(')') ? name : `${name}(x: number): void`,
    doc_comment: i % 5 === 0 ? `/** Doc for ${name} */` : null,
    parent_id: null,
    language: 'typescript',
    is_exported: i % 2 === 0 ? 1 : 0,
    updated_at: Date.now(),
  };
}

/** Make a random embedding vector */
function makeEmbedding(): Float32Array {
  return Float32Array.from({ length: 384 }, () => Math.random());
}

// ---- Module-level store setup (beforeAll does not run in vitest bench mode v2.1.x) ----

// SQLite store for symbol + reference queries
const SQLITE_DIR = join(tmpdir(), `hesman-perf-query-sqlite-${Date.now()}`);
let sqliteStore: SqliteStore;
let zvecStore: ZVecStore;

{
  if (existsSync(SQLITE_DIR)) rmSync(SQLITE_DIR, { recursive: true });
  mkdirSync(SQLITE_DIR, { recursive: true });

  sqliteStore = new SqliteStore(SQLITE_DIR);
  sqliteStore.open();

  // Populate with synthetic symbols
  const rows: SymbolRow[] = [];
  for (let i = 0; i < SYMBOL_COUNT; i++) {
    rows.push(makeSymbol(i));
  }
  sqliteStore.upsertSymbols(rows);

  // Populate relations
  const relations: Array<{
    from_id: string; to_id: string; kind: string; file_path: string; line: number; col: number;
  }> = [];
  for (let i = 1; i < SYMBOL_COUNT; i++) {
    relations.push({
      from_id: `sym_${i}`, to_id: `sym_${i - 1}`,
      kind: 'calls', file_path: `src/module_${i % 10}.ts`,
      line: i * 3 + 2, col: 4,
    });
  }
  sqliteStore.upsertRelations(relations);
}

// ZVec store for semantic search benchmarks
const ZVEC_DIR = join(tmpdir(), `hesman-perf-query-zvec-${Date.now()}`);
{
  if (existsSync(ZVEC_DIR)) rmSync(ZVEC_DIR, { recursive: true });
  mkdirSync(ZVEC_DIR, { recursive: true });

  zvecStore = new ZVecStore(ZVEC_DIR);
  zvecStore.open();

  const docs: SearchDoc[] = [];
  const embs: Float32Array[] = [];
  for (let i = 0; i < 1000; i++) {
    docs.push({
      symbolId: `sym_${i}`,
      name: i % 3 === 0 ? `searchFn_${i}` : `dataProc_${i}`,
      kind: i % 4 === 0 ? 'function' : i % 4 === 1 ? 'class' : 'method',
      filePath: `src/module_${i % 20}.ts`,
      startLine: i * 5,
      endLine: i * 5 + 3,
      signature: `(${i % 2 === 0 ? 'x: number' : 's: string'}): ${i % 2 === 0 ? 'number' : 'string'}`,
      code: `function ${i % 3 === 0 ? 'searchFn' : 'dataProc'}_${i}(x: ${i % 2 === 0 ? 'number' : 'string'}): ${i % 2 === 0 ? 'number' : 'string'} { return x; }`,
      docComment: null,
      language: 'typescript',
    });
    embs.push(makeEmbedding());
  }
  zvecStore.upsertDocs(docs, embs);
}

// Register cleanup
process.on('exit', () => {
  try { sqliteStore.close(); } catch { /* ok */ }
  try { zvecStore.close(); } catch { /* ok */ }
  if (existsSync(SQLITE_DIR)) rmSync(SQLITE_DIR, { recursive: true });
  if (existsSync(ZVEC_DIR)) rmSync(ZVEC_DIR, { recursive: true });
});

// ---- Benchmarks ----

describe('query benchmarks — find_symbol', () => {
  bench('find_symbol exact match', () => {
    sqliteStore.getSymbolsByName('findMe_500', undefined, undefined, 20, 'exact');
  }, { time: 5_000 });

  bench('find_symbol exact with kind filter', () => {
    sqliteStore.getSymbolsByName('findMe_500', 'function', undefined, 20, 'exact');
  }, { time: 5_000 });

  bench('find_symbol prefix match', () => {
    sqliteStore.getSymbolsByName('handler', undefined, undefined, 20, 'prefix');
  }, { time: 5_000 });

  bench('find_symbol fuzzy (FTS5)', () => {
    sqliteStore.getSymbolsByName('findMe', undefined, undefined, 20, 'fuzzy');
  }, { time: 5_000 });
});

describe('query benchmarks — get_references', () => {
  bench('get_references (all kinds)', () => {
    sqliteStore.getReferences('sym_100');
  }, { time: 5_000 });

  bench('get_references (calls only)', () => {
    sqliteStore.getReferences('sym_100', 'calls');
  }, { time: 5_000 });

  bench('get_references with cursor pagination', () => {
    sqliteStore.getReferences('sym_100', undefined, 10);
  }, { time: 5_000 });
});

describe('query benchmarks — semantic_search (ZVec)', () => {
  bench('ZVec search (1k docs, no filter)', () => {
    zvecStore.search({ queryVector: makeEmbedding(), topK: 10 });
  }, { time: 5_000 });

  bench('ZVec search with kind filter', () => {
    zvecStore.search({ queryVector: makeEmbedding(), topK: 10, kind: 'function' });
  }, { time: 5_000 });

  bench('ZVec search with language filter', () => {
    zvecStore.search({ queryVector: makeEmbedding(), topK: 10, language: 'typescript' });
  }, { time: 5_000 });
});
