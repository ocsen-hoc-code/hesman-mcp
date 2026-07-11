import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { pruneContext } from '../../../src/parsers/context-pruner';
import { SqliteStore } from '../../../src/stores/sqlite';
import { initParser } from '../../../src/parsers/core';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'hesman-pruner-test');
const DATA_DIR = join(TEST_DIR, '.hesman');

const TEST_FILE = `
import { unused } from './unused';
import { helper } from './helper';

/** Main entry */
export function main() {
  const x = helper(1);
  return x;
}

function helper(n: number): number {
  return n * 2;
}

function unrelated() {
  // This function has nothing to do with main()
  return "hello";
}

class UnrelatedClass {
  method1() { return 1; }
  method2() { return 2; }
}
`;

describe('context pruner', () => {
  let store: SqliteStore;

  beforeAll(async () => {
    await initParser(tsProfile);
  });

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(join(TEST_DIR, 'test.ts'), TEST_FILE);
    store = new SqliteStore(DATA_DIR);
    store.open();
    // Insert symbols
    store.upsertSymbols([
      { id: 'main', name: 'main', kind: 'function', file_path: join(TEST_DIR, 'test.ts'), start_line: 6, end_line: 9, start_col: 0, end_col: 1, signature: 'export function main()', doc_comment: 'Main entry', parent_id: null, language: 'typescript', is_exported: 1, updated_at: Date.now() },
      { id: 'helper', name: 'helper', kind: 'function', file_path: join(TEST_DIR, 'test.ts'), start_line: 11, end_line: 13, start_col: 0, end_col: 1, signature: 'function helper(n: number): number', doc_comment: null, parent_id: null, language: 'typescript', is_exported: 0, updated_at: Date.now() },
      { id: 'unrelated', name: 'unrelated', kind: 'function', file_path: join(TEST_DIR, 'test.ts'), start_line: 15, end_line: 17, start_col: 0, end_col: 1, signature: 'function unrelated()', doc_comment: null, parent_id: null, language: 'typescript', is_exported: 0, updated_at: Date.now() },
      { id: 'unrelatedclass', name: 'UnrelatedClass', kind: 'class', file_path: join(TEST_DIR, 'test.ts'), start_line: 19, end_line: 22, start_col: 0, end_col: 1, signature: 'class UnrelatedClass', doc_comment: null, parent_id: null, language: 'typescript', is_exported: 0, updated_at: Date.now() },
    ]);
    // Insert relation: main calls helper
    store.upsertRelations([
      { from_id: 'main', to_id: 'helper', kind: 'calls', file_path: join(TEST_DIR, 'test.ts'), line: 7, col: 12 },
    ]);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('keeps focus symbol and its JSDoc', async () => {
    const source = readFileSync(join(TEST_DIR, 'test.ts'), 'utf-8');
    const result = await pruneContext(source, join(TEST_DIR, 'test.ts'), 'main', store);

    expect(result.keptLines).toBeLessThan(result.totalLines);
    expect(result.content).toContain('export function main()');
    expect(result.content).toContain('Main entry'); // JSDoc preserved
  });

  it('keeps direct callee signatures', async () => {
    const source = readFileSync(join(TEST_DIR, 'test.ts'), 'utf-8');
    const result = await pruneContext(source, join(TEST_DIR, 'test.ts'), 'main', store);

    expect(result.content).toContain('function helper');
  });

  it('prunes unrelated functions with omission markers', async () => {
    const source = readFileSync(join(TEST_DIR, 'test.ts'), 'utf-8');
    const result = await pruneContext(source, join(TEST_DIR, 'test.ts'), 'main', store);

    // Unrelated function should be pruned
    expect(result.prunedSections.length).toBeGreaterThan(0);
    expect(result.content).toContain('omitted');
  });

  it('prunes unused imports', async () => {
    const source = readFileSync(join(TEST_DIR, 'test.ts'), 'utf-8');
    const result = await pruneContext(source, join(TEST_DIR, 'test.ts'), 'main', store);

    expect(result.content).not.toContain('unused');
  });
});
