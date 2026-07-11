import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { summarizeSymbol, compressCallChain } from '../../../src/parsers/summarizer';
import { SqliteStore } from '../../../src/stores/sqlite';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const TEST_DIR = '.hesman-test-summarizer';

describe('summarizeSymbol', () => {
  let store: SqliteStore;
  const now = Date.now();

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new SqliteStore(TEST_DIR);
    store.open();
    store.upsertSymbols([
      { id: 'f1', name: 'processData', kind: 'function', file_path: 'src/a.ts', start_line: 1, end_line: 50, start_col: 0, end_col: 1, signature: 'function processData(items: Item[]): Result[]', doc_comment: 'Process data items and return results', parent_id: null, language: 'typescript', is_exported: 1, updated_at: now },
      { id: 'f2', name: 'validate', kind: 'function', file_path: 'src/a.ts', start_line: 52, end_line: 60, start_col: 0, end_col: 1, signature: 'function validate(item: Item): boolean', doc_comment: null, parent_id: null, language: 'typescript', is_exported: 0, updated_at: now },
    ]);
    store.upsertRelations([
      { from_id: 'f1', to_id: 'f2', kind: 'calls', file_path: 'src/a.ts', line: 30, col: 5 },
    ]);
  });

  afterEach(() => {
    store.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('returns signature, doc, and complexity', async () => {
    const summary = await summarizeSymbol('f1', store);
    expect(summary.signature).toContain('processData');
    expect(summary.doc).toContain('Process data items');
    expect(summary.complexity.lines).toBeGreaterThan(0);
    expect(summary.complexity.params).toBeGreaterThan(0);
  });

  it('lists called symbols with counts', async () => {
    const summary = await summarizeSymbol('f1', store);
    expect(summary.calls.length).toBeGreaterThan(0);
    expect(summary.calls[0].name).toBe('validate');
  });

  it('compressCallChain reduces entries to paths', () => {
    const entries = [
      { symbolId: 'a', name: 'main', kind: 'function', filePath: 'a.ts', startLine: 1, depth: 1, callSite: { filePath: 'a.ts', line: 10 } },
      { symbolId: 'b', name: 'init', kind: 'function', filePath: 'b.ts', startLine: 1, depth: 1, callSite: { filePath: 'b.ts', line: 5 } },
      { symbolId: 'c', name: 'setup', kind: 'function', filePath: 'c.ts', startLine: 1, depth: 2, callSite: { filePath: 'c.ts', line: 1 } },
    ];
    const result = compressCallChain(entries, 2);
    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.summary).toContain('3 callers');
  });
});
