import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ZVecStore, quoteFilterValue, canQuoteFilterValue, lexicalScore, type SearchDoc } from '../../../src/stores/zvec';
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

  /** A unit vector pointing along the given (first few) coordinates. */
  const unitVector = (coords: number[]): Float32Array => {
    const v = new Float32Array(384);
    coords.forEach((x, i) => { v[i] = x; });
    const norm = Math.hypot(...coords);
    return v.map(x => x / norm);
  };

  it('ranks the most similar vector first, scoring by cosine similarity clamped to [0, 1]', () => {
    store.upsertDocs(
      [makeDoc('orthogonal'), makeDoc('same'), makeDoc('near')],
      [unitVector([0, 1]), unitVector([1, 0]), unitVector([1, 1])],
    );

    const results = store.search({ queryVector: unitVector([1, 0]), topK: 3 });

    expect(results.map(r => r.symbolId)).toEqual(['same', 'near', 'orthogonal']);
    expect(results[0].score).toBeCloseTo(1, 3);
    expect(results[1].score).toBeCloseTo(Math.SQRT1_2, 3);
    expect(results[2].score).toBeCloseTo(0, 3);
  });

  it('never returns a negative score for an opposite vector', () => {
    store.upsertDocs([makeDoc('opposite')], [unitVector([-1, 0])]);
    const [result] = store.search({ queryVector: unitVector([1, 0]), topK: 1 });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('with queryText, blends in a lexical name match that can lift a slightly less similar symbol', () => {
    store.upsertDocs(
      [makeDoc('vectorOnly', { name: 'buildGreeting' }), makeDoc('lexical', { name: 'formatName' })],
      [unitVector([1, 0]), unitVector([0.95, 0.31])],
    );

    const results = store.search({ queryVector: unitVector([1, 0]), queryText: 'format a name', topK: 2 });

    expect(results.map(r => r.symbolId)).toEqual(['lexical', 'vectorOnly']);
    expect(results[0].matchType).toBe('both');
    expect(results[1].matchType).toBe('semantic');
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('with queryText, still returns at most topK results', () => {
    const docs = Array.from({ length: 6 }, (_, i) => makeDoc(`d${i}`, { name: `formatName${i}` }));
    store.upsertDocs(docs, docs.map(() => makeEmbedding()));
    const results = store.search({ queryVector: makeEmbedding(), queryText: 'format name', topK: 2 });
    expect(results).toHaveLength(2);
  });

  it('applies filePattern before cutting to topK', () => {
    const docs = [
      ...Array.from({ length: 4 }, (_, i) => makeDoc(`a${i}`, { filePath: `src/a${i}.ts` })),
      makeDoc('wanted', { filePath: 'lib/wanted.py' }),
    ];
    store.upsertDocs(docs, [
      unitVector([1, 0]), unitVector([1, 0.1]), unitVector([1, 0.2]), unitVector([1, 0.3]), unitVector([0, 1]),
    ]);
    const results = store.search({ queryVector: unitVector([1, 0]), topK: 2, filePattern: 'lib/**' });
    expect(results.map(r => r.symbolId)).toEqual(['wanted']);
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

describe('lexicalScore', () => {
  it('is the share of query words found in the split symbol name', () => {
    expect(lexicalScore('format a person name', 'tsFormatName')).toBeCloseTo(2 / 3, 5);
    expect(lexicalScore('format name', 'py_format_name')).toBe(1);
  });

  it('ignores stop words and matches simple inflections', () => {
    expect(lexicalScore('the greeting', 'GoGreet')).toBe(1);
    expect(lexicalScore('parsing the items', 'parseItem')).toBe(1);
  });

  it('is 0 when nothing matches or the query has only stop words', () => {
    expect(lexicalScore('retry with backoff', 'formatName')).toBe(0);
    expect(lexicalScore('a the of', 'formatName')).toBe(0);
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
