import { bench, describe } from 'vitest';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SqliteStore } from '../../src/stores/sqlite';
import { parseFile } from '../../src/parsers/core';
import { tsProfile } from '../../src/parsers/profiles/typescript';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'ts-basic');
const BENCH_DIR = join(tmpdir(), `hesman-perf-idx-${Date.now()}`);
const SRC_DIR = join(BENCH_DIR, 'src');
const DATA_DIR = join(BENCH_DIR, '.data');

/** Generate a realistic TypeScript module */
function makeModule(index: number): string {
  return [
    `export interface Opts${index} { host: string; port: number; tls: boolean; }`,
    `export function create${index}(val: number): number { return val * ${index}; }`,
    `export class Handler${index} {`,
    `  private id = ${index};`,
    `  run(input: string): string { return input + this.id; }`,
    `}`,
    `export const VER${index} = ${index};`,
  ].join('\n');
}

// ---- Module-level setup (beforeAll does not run in vitest bench mode v2.1.x) ----

if (existsSync(BENCH_DIR)) rmSync(BENCH_DIR, { recursive: true });
mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

// Load the ts-basic fixture: copy fixture source files into the benchmark set
const fixtureSrcDir = join(FIXTURE_DIR, 'src');
if (existsSync(fixtureSrcDir)) {
  for (const entry of readdirSync(fixtureSrcDir)) {
    if (entry.endsWith('.ts')) {
      copyFileSync(join(fixtureSrcDir, entry), join(SRC_DIR, `fixture_${entry}`));
    }
  }
}

// Generate synthetic modules (parsing performance test data)
for (let i = 0; i < 20; i++) {
  writeFileSync(join(SRC_DIR, `module_${i}.ts`), makeModule(i));
}

// Open the symbol store
const store = new SqliteStore(DATA_DIR);
store.open();

// Register cleanup
process.on('exit', () => {
  try { store.close(); } catch { /* ok */ }
  if (existsSync(BENCH_DIR)) rmSync(BENCH_DIR, { recursive: true });
});

// ---- Benchmarks ----

describe('indexing throughput', () => {
  // Benchmark: parse one TypeScript file + store symbols in SQLite.
  // Each iteration measures the full indexing pipeline for a single file.
  // vitest reports hz (iterations/sec) = files/sec throughput.
  bench('parse + sqlite upsert (1 file)', async () => {
    const filePath = join(SRC_DIR, 'module_0.ts');
    const result = await parseFile(filePath, tsProfile);

    store.clearSymbols(filePath);
    store.upsertSymbols(
      result.symbols.map((s) => ({ ...s, updated_at: Date.now() })),
    );
  }, { time: 10_000 });
});
