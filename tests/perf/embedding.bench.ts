import { bench, describe, beforeAll } from 'vitest';
import { initEmbedding, embedText, embedBatch } from '../../src/stores/embedding';

describe('embedding benchmarks', () => {
  beforeAll(async () => {
    await initEmbedding('Xenova/all-MiniLM-L6-v2');
  }, 120_000);

  bench(
    'embed single code chunk (~500 chars)',
    async () => {
      const text =
        'function processData(items: DataItem[], options: ProcessOptions): Result {\n' +
        '  const filtered = items.filter(item => item.active);\n' +
        '  const transformed = filtered.map(item => transform(item, options));\n' +
        '  return { count: transformed.length, data: transformed };\n' +
        '}';
      await embedText(text);
    },
    { time: 10_000 },
  );

  bench(
    'embed batch of 50 code chunks',
    async () => {
      const texts = Array.from(
        { length: 50 },
        (_, i) =>
          `function handler${i}(input: Input${i}): Output${i} {\n  return transform(input);\n}`,
      );
      await embedBatch(texts);
    },
    { time: 30_000 },
  );
});
