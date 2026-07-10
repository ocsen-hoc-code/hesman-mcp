import { bench, describe, beforeAll, afterAll } from 'vitest';
import { ZVecStore, type SearchDoc } from '../../src/stores/zvec';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const TEST_DIR = '.hesman-perf-zvec';

function makeEmbedding(): Float32Array {
  return Float32Array.from({ length: 384 }, () => Math.random());
}

function createDocs(docCount: number): { docs: SearchDoc[]; embs: Float32Array[] } {
  const docs: SearchDoc[] = [];
  const embs: Float32Array[] = [];
  for (let i = 0; i < docCount; i++) {
    docs.push({
      symbolId: `sym_${i}`,
      name: `function_${i}`,
      kind: 'function',
      filePath: `src/module${i % 10}.ts`,
      startLine: i * 5,
      endLine: i * 5 + 3,
      signature: `function function_${i}(x: number): number`,
      code: `function function_${i}(x: number): number {\n  return x * ${i};\n}`,
      docComment: null,
      language: 'typescript',
    });
    embs.push(makeEmbedding());
  }
  return { docs, embs };
}

describe('ZVec search benchmarks', () => {
  let store: ZVecStore;

  beforeAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new ZVecStore(TEST_DIR);
    store.open();
    const { docs, embs } = createDocs(1000);
    store.upsertDocs(docs, embs);
  });

  afterAll(() => {
    try { store.close(); } catch { /* ok */ }
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  bench('vector search (1k docs)', () => {
    store.search({ queryVector: makeEmbedding(), topK: 10 });
  }, { time: 10_000 });

  bench('search with kind filter', () => {
    store.search({ queryVector: makeEmbedding(), topK: 10, kind: 'function' });
  }, { time: 10_000 });

  bench('search with language filter', () => {
    store.search({ queryVector: makeEmbedding(), topK: 10, language: 'typescript' });
  }, { time: 10_000 });
});
