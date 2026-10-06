import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ZVecStore, quoteFilterValue, canQuoteFilterValue, type SearchDoc } from '../../../src/stores/zvec';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const TEST_DIR = '.hesman-test-zvec';

describe('ZVecStore', () => {
  let store: ZVecStore;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new ZVecStore(TEST_DIR);
    store.open();
  });

  afterEach(() => {
    try { store.close(); } catch { /* already closed */ }
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  const makeDoc = (id: string, overrides: Partial<SearchDoc> = {}): SearchDoc => ({
    symbolId: id,
    name: `fn_${id}`,
    kind: 'function',
    filePath: 'src/test.ts',
    startLine: 1,
    endLine: 3,
    signature: `function fn_${id}(x: number): number`,
    code: `function fn_${id}(x: number): number {\n  return x * 2;\n}`,
    docComment: null,
    language: 'typescript',
    ...overrides,
  });

  const makeEmbedding = (): Float32Array => {
    return Float32Array.from({ length: 384 }, () => Math.random());
  };

  it('opens and stores documents', () => {
    const docs = [makeDoc('s1'), makeDoc('s2')];
    const embs = [makeEmbedding(), makeEmbedding()];
    store.upsertDocs(docs, embs);
    expect(store.stats().docCount).toBe(2);
  });

  it('searches and returns results sorted by score', () => {
    const docs = [
      makeDoc('s1', { name: 'add', code: 'function add(a, b) { return a + b; }' }),
      makeDoc('s2', { name: 'multiply', code: 'function multiply(x, y) { return x * y; }' }),
      makeDoc('s3', { name: 'getUser', code: 'async function getUser(id) { return db.find(id); }' }),
    ];
    const embs = [makeEmbedding(), makeEmbedding(), makeEmbedding()];
    store.upsertDocs(docs, embs);

    const queryVec = makeEmbedding();
    const results = store.search({ queryVector: queryVec, topK: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it('searches with language filter', () => {
    const docs = [
      makeDoc('s1', { language: 'typescript' }),
      makeDoc('s2', { language: 'python' }),
    ];
    const embs = [makeEmbedding(), makeEmbedding()];
    store.upsertDocs(docs, embs);

    const results = store.search({ queryVector: makeEmbedding(), topK: 10, language: 'python' });
    expect(results).toHaveLength(1);
    expect(results[0].symbolId).toBe('s2');
  });

  it('searches with kind filter', () => {
    const docs = [
      makeDoc('s1', { kind: 'function' }),
      makeDoc('s2', { kind: 'class' }),
    ];
    const embs = [makeEmbedding(), makeEmbedding()];
    store.upsertDocs(docs, embs);

    const results = store.search({ queryVector: makeEmbedding(), topK: 10, kind: 'class' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('fn_s2');
  });

  it('deleteByFile removes correct documents', () => {
    const docs = [
      makeDoc('s1', { filePath: 'src/a.ts' }),
      makeDoc('s2', { filePath: 'src/b.ts' }),
    ];
    const embs = [makeEmbedding(), makeEmbedding()];
    store.upsertDocs(docs, embs);
    expect(store.stats().docCount).toBe(2);

    store.deleteByFile('src/a.ts');
    expect(store.stats().docCount).toBe(1);

    const results = store.search({ queryVector: makeEmbedding(), topK: 10 });
    expect(results.every(r => r.filePath === 'src/b.ts')).toBe(true);
  });

  it("deleteByFile handles a path containing ' without touching other files", () => {
    const docs = [
      makeDoc('s1', { filePath: "/p/O'Brien/a.ts" }),
      makeDoc('s2', { filePath: '/p/O' }),
      makeDoc('s3', { filePath: '/p/b.ts' }),
    ];
    store.upsertDocs(docs, [makeEmbedding(), makeEmbedding(), makeEmbedding()]);

    store.deleteByFile("/p/O'Brien/a.ts");
    const left = store.search({ queryVector: makeEmbedding(), topK: 10 }).map(r => r.symbolId).sort();
    expect(left).toEqual(['s2', 's3']);
  });

  it('deleteByFile removes documents by id when the path cannot be quoted', () => {
    const winPath = 'C:\\proj\\src\\a.ts';
    const docs = [
      makeDoc('s1', { filePath: winPath }),
      makeDoc('s2', { filePath: winPath }),
      makeDoc('s3', { filePath: 'src/b.ts' }),
    ];
    store.upsertDocs(docs, [makeEmbedding(), makeEmbedding(), makeEmbedding()]);

    store.deleteByFile(winPath, ['s1', 's2', 'missing-id']);
    const left = store.search({ queryVector: makeEmbedding(), topK: 10 }).map(r => r.symbolId);
    expect(left).toEqual(['s3']);
  });

  it('search rejects kind and language values outside the known sets', () => {
    store.upsertDocs([makeDoc('s1')], [makeEmbedding()]);
    expect(() => store.search({ queryVector: makeEmbedding(), topK: 10, kind: "function' OR '1'='1" })).toThrow();
    expect(() => store.search({ queryVector: makeEmbedding(), topK: 10, language: "x' OR '1'='1" })).toThrow();
  });

  it('persists data across close/re-open', () => {
    store.upsertDocs([makeDoc('s1')], [makeEmbedding()]);
    store.close();

    const store2 = new ZVecStore(TEST_DIR);
    store2.open();
    expect(store2.stats().docCount).toBe(1);
    store2.close();
  });

  it('clear destroys and recreates collection', () => {
    store.upsertDocs([makeDoc('s1')], [makeEmbedding()]);
    store.clear();
    expect(store.stats().docCount).toBe(0);
  });

  it('handles empty upsert gracefully', () => {
    store.upsertDocs([], []);
    expect(store.stats().docCount).toBe(0);
  });
});

describe('quoteFilterValue', () => {
  it("escapes ' with a backslash and leaves \" alone", () => {
    expect(quoteFilterValue("O'Brien")).toBe("'O\\'Brien'");
    expect(quoteFilterValue('a"b')).toBe("'a\"b'");
  });

  it('rejects values ZVec cannot represent (backslash, control characters)', () => {
    for (const bad of ['a\\b', 'trailing\\', 'line\nbreak', 'tab\tx', 'nul\u0000']) {
      expect(canQuoteFilterValue(bad)).toBe(false);
      expect(() => quoteFilterValue(bad)).toThrow();
    }
  });
});
