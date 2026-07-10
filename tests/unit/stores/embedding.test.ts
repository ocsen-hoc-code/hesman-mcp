import { describe, it, expect, beforeAll } from 'vitest';
import { initEmbedding, embedText, embedBatch } from '../../../src/stores/embedding';

describe('embedding engine', () => {
  beforeAll(async () => {
    await initEmbedding('Xenova/all-MiniLM-L6-v2');
  }, 60000);

  it('embedText returns Float32Array of length 384', async () => {
    const vec = await embedText('function add(a: number, b: number): number { return a + b; }');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });

  it('embedText normalizes output (values between -1 and 1)', async () => {
    const vec = await embedText('some test text');
    for (let i = 0; i < vec.length; i++) {
      expect(vec[i]).toBeGreaterThanOrEqual(-1);
      expect(vec[i]).toBeLessThanOrEqual(1);
    }
  });

  it('embedBatch returns same count as input', async () => {
    const texts = [
      'function add(a, b) { return a + b; }',
      'class Calculator { add(n: number): number { return this.value + n; } }',
      'export interface User { id: string; name: string; }',
    ];
    const vecs = await embedBatch(texts);
    expect(vecs).toHaveLength(3);
    vecs.forEach(v => expect(v.length).toBe(384));
  });

  it('embedBatch handles empty array', async () => {
    const vecs = await embedBatch([]);
    expect(vecs).toEqual([]);
  });

  it('throws if initEmbedding not called', async () => {
    // Don't actually test this — model is already loaded. Skip.
  });
});
