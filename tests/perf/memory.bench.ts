import { bench, describe } from 'vitest';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { THRESHOLDS } from './thresholds';
import { SqliteStore, type SymbolRow } from '../../src/stores/sqlite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// fixture dir available for future use
const _FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'ts-basic');
const SYMBOL_COUNT = 5000;

/** Generate a symbol row for the memory test */
function makeSymbol(i: number): SymbolRow {
  return {
    id: `mem_sym_${i}`,
    name: `memFn_${i}_${i % 2 === 0 ? 'process' : 'validate'}`,
    kind: i % 3 === 0 ? 'function' : i % 3 === 1 ? 'class' : 'variable',
    file_path: `src/module_${i % 50}.ts`,
    start_line: i * 4,
    end_line: i * 4 + 6,
    start_col: 0,
    end_col: 60,
    signature: `(${i % 2 === 0 ? 'data: string' : 'input: number'}): ${i % 2 === 0 ? 'string' : 'number'}`,
    doc_comment: i % 7 === 0 ? `/** Mem benchmark symbol ${i} */` : null,
    parent_id: null,
    language: 'typescript',
    is_exported: i % 3 !== 2 ? 1 : 0,
    updated_at: Date.now(),
  };
}

// ---- Module-level setup (beforeAll does not run in vitest bench mode v2.1.x) ----

const MEM_DIR = join(tmpdir(), `hesman-perf-mem-${Date.now()}`);
let store: SqliteStore;

{
  if (existsSync(MEM_DIR)) rmSync(MEM_DIR, { recursive: true });
  mkdirSync(MEM_DIR, { recursive: true });

  store = new SqliteStore(MEM_DIR);
  store.open();

  // Populate with synthetic symbols
  const batchSize = 500;
  const rows: SymbolRow[] = [];
  for (let i = 0; i < SYMBOL_COUNT; i++) {
    rows.push(makeSymbol(i));
  }
  for (let i = 0; i < rows.length; i += batchSize) {
    store.upsertSymbols(rows.slice(i, i + batchSize));
  }

  // Add relations to simulate a realistic index
  const relations: Array<{
    from_id: string; to_id: string; kind: string; file_path: string; line: number; col: number;
  }> = [];
  for (let i = 1; i < SYMBOL_COUNT; i++) {
    if (i % 5 === 0) {
      relations.push({
        from_id: `mem_sym_${i}`, to_id: `mem_sym_${i - 1}`,
        kind: 'calls', file_path: `src/module_${i % 50}.ts`,
        line: i * 4 + 2, col: 4,
      });
    }
  }
  store.upsertRelations(relations);

  // Force a GC-friendly pause
  if (global.gc) global.gc();
}

// Register cleanup
process.on('exit', () => {
  try { store.close(); } catch { /* ok */ }
  if (existsSync(MEM_DIR)) rmSync(MEM_DIR, { recursive: true });
});

// ---- Benchmarks ----

describe('memory after indexing', () => {
  bench('heap used after index', () => {
    const mem = process.memoryUsage();
    const _heapUsedMB = mem.heapUsed / 1024 / 1024;
    // Benchmark measures heap usage via process.memoryUsage()
  }, { time: 1_000 });

  bench('RSS after index (asserts within threshold)', () => {
    const mem = process.memoryUsage();
    const rssMB = mem.rss / 1024 / 1024;
    if (rssMB > THRESHOLDS.memoryAfterIndex) {
      throw new Error(
        `RSS ${rssMB.toFixed(1)}MB exceeds threshold ${THRESHOLDS.memoryAfterIndex}MB`,
      );
    }
  }, { time: 1_000 });

  bench('external memory after index', () => {
    const mem = process.memoryUsage();
    const _externalMB = mem.external / 1024 / 1024;
    // Benchmark measures external memory via process.memoryUsage()
  }, { time: 1_000 });
});
