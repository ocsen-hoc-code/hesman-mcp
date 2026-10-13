import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, mkdirSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'ts-basic');
const TEST_DATA = resolve(FIXTURE_DIR, '.hesman-compression-test');

async function setupStores() {
  const { indexProject } = await import('../../src/indexing/index-coordinator');
  const { SqliteStore } = await import('../../src/stores/sqlite');
  const { defaultConfig } = await import('../../src/config/defaults');

  const store = new SqliteStore(TEST_DATA);
  store.open();

  const result = await indexProject(FIXTURE_DIR, store, defaultConfig);

  return { store, result };
}

describe('compression pipeline integration', () => {
  beforeAll(() => {
    if (existsSync(TEST_DATA)) rmSync(TEST_DATA, { recursive: true });
    mkdirSync(TEST_DATA, { recursive: true });
  }, 60000);

  afterAll(() => {
    try {
      if (existsSync(TEST_DATA)) rmSync(TEST_DATA, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('indexes fixture project for compression tests', async () => {
    const { store, result } = await setupStores();
    expect(result.filesIndexed).toBeGreaterThanOrEqual(2);
    expect(result.symbolsFound).toBeGreaterThan(0);
    store.close();
  }, 30000);

  it('response compressor adds _meta._reduction on all tool outputs', async () => {
    const { store } = await setupStores();

    // Dynamically import the compressor
    const { compressToolResponse } = await import('../../src/server/response-compressor');
    const { compactCode } = await import('../../src/parsers/compact-mode');

    // Verify that code compression works on fixture source
    const utilsPath = resolve(FIXTURE_DIR, 'src', 'utils.ts');
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(utilsPath, 'utf-8');

    const compressed = compactCode(source);
    expect(compressed.length).toBeLessThan(source.length);
    // JSDoc-style comments should be stripped
    expect(compressed).not.toMatch(/\/\*[\s\S]*?\*\//);
    // Line comments should be stripped
    expect(compressed).not.toContain('Not exported');

    const indexPath = resolve(FIXTURE_DIR, 'src', 'index.ts');

    // Test compressToolResponse with find_symbol output
    const findResult = compressToolResponse('find_symbol', {
      symbols: [
        { id: 's1', name: 'add', kind: 'function', filePath: indexPath, isExported: true },
      ],
    });
    expect(findResult._meta).toBeDefined();
    expect(findResult._meta.reduction).toBeDefined();
    expect(typeof findResult._meta.reduction).toBe('string');

    // Test compressToolResponse with get_context output (code content)
    const contextResult = compressToolResponse('get_context', {
      filePath: indexPath,
      language: 'typescript',
      content: '// a comment\nfunction add(a: number, b: number): number {\n  return a + b;\n}',
      totalLines: 3,
      symbolsInRange: [],
    });
    expect(contextResult._meta).toBeDefined();
    expect(contextResult._meta.layers).toContain('compact');
    // Comment should have been stripped
    expect(contextResult.content).not.toContain('// a comment');
    // Original content should still be present minus comments
    expect(contextResult.content).toContain('function add');

    // Test compressToolResponse with get_references output (_summary)
    const refResult = compressToolResponse('get_references', {
      references: [
        { filePath: 'src/index.ts', kind: 'calls', line: 10 },
        { filePath: 'src/utils.ts', kind: 'exports', line: 1 },
      ],
      totalCount: 2,
    }, { format: 'full' });
    // _summary only adds tokens, so it is dropped rather than inflating the payload (M0-15)
    expect(refResult._summary).toBeUndefined();
    expect(refResult.references).toHaveLength(2);
    expect(refResult._meta.compressed).toBe(false);
    expect(parseFloat(refResult._meta.reduction)).toBeGreaterThanOrEqual(0);

    // Test compressToolResponse with get_callers output (chain compression)
    const callersResult = compressToolResponse('get_callers', {
      callers: [
        { name: 'main', depth: 1, filePath: 'src/index.ts' },
      ],
    }, { format: 'full' });
    expect(callersResult._summary).toBeUndefined();
    expect(callersResult.callers).toHaveLength(1);
    expect(callersResult._meta.compressed).toBe(false);
    expect(parseFloat(callersResult._meta.reduction)).toBeGreaterThanOrEqual(0);

    // Test compression with impact_analysis output
    const impactResult = compressToolResponse('impact_analysis', {
      symbol: { id: 's1', name: 'add' },
      changeType: 'rename',
      impactedFiles: ['src/index.ts', 'src/utils.ts'],
      _summary: { estimatedChanges: 2 },
    });
    expect(impactResult._meta).toBeDefined();
    expect(impactResult._meta.reduction).toBeDefined();

    store.close();
  }, 30000);

  it('context pruner reduces file to focused content', async () => {
    const { store } = await setupStores();

    const { pruneContext } = await import('../../src/parsers/context-pruner');
    const { readFileSync } = await import('node:fs');

    const indexPath = resolve(FIXTURE_DIR, 'src', 'index.ts');
    const source = readFileSync(indexPath, 'utf-8');

    // Get a known symbol from the store
    const symbols = store.getSymbolsByName('add');
    expect(symbols.length).toBeGreaterThan(0);
    const addSymbol = symbols[0];

    // Prune context around the 'add' function
    const result = await pruneContext(source, indexPath, addSymbol.id, store);

    expect(result.totalLines).toBeGreaterThan(0);
    expect(result.keptLines).toBeGreaterThan(0);
    // The pruned content should be smaller than the original
    expect(result.content.length).toBeLessThanOrEqual(source.length);
    // There should be pruned sections or the content is already small
    expect(result.prunedSections).toBeDefined();
    // The 'add' function itself should be in the output
    expect(result.content).toContain('add');

    store.close();
  }, 30000);

  it('summarizer returns structured summary for symbols', async () => {
    const { store } = await setupStores();

    const { summarizeSymbol } = await import('../../src/parsers/summarizer');

    // Get a known symbol
    const symbols = store.getSymbolsByName('add');
    expect(symbols.length).toBeGreaterThan(0);
    const addSymbol = symbols[0];

    // Summarize the symbol
    const summary = await summarizeSymbol(addSymbol.id, store);

    expect(summary.signature).toBeDefined();
    expect(summary.signature).toContain('add');
    expect(summary.complexity).toBeDefined();
    expect(summary.complexity.lines).toBeGreaterThan(0);
    expect(summary.complexity.params).toBeGreaterThanOrEqual(0);
    expect(summary.complexity.callCount).toBeGreaterThanOrEqual(0);
    // Should include return type info (e.g. ': number')
    expect(summary.signature).toMatch(/:\s*\w/);

    store.close();
  }, 30000);

  it('summarizer handles symbols with no callees gracefully', async () => {
    const { store } = await setupStores();

    const { summarizeSymbol } = await import('../../src/parsers/summarizer');

    // Find a simple symbol (e.g., formatGreeting which may not call anything)
    const symbols = store.getSymbolsByName('formatGreeting');
    expect(symbols.length).toBeGreaterThan(0);
    const symbol = symbols[0];

    const summary = await summarizeSymbol(symbol.id, store, { includeCalls: false });

    expect(summary.signature).toBeDefined();
    expect(summary.complexity).toBeDefined();
    // When includeCalls is false, calls should be empty
    expect(summary.calls).toHaveLength(0);

    store.close();
  }, 30000);

  it('compression pipeline end-to-end: compact -> prune -> summarize -> compress', async () => {
    const { store } = await setupStores();

    const { compressToolResponse } = await import('../../src/server/response-compressor');
    const { pruneContext } = await import('../../src/parsers/context-pruner');
    const { summarizeSymbol } = await import('../../src/parsers/summarizer');
    const { compactCode } = await import('../../src/parsers/compact-mode');
    const { readFileSync } = await import('node:fs');

    const indexPath = resolve(FIXTURE_DIR, 'src', 'index.ts');
    const source = readFileSync(indexPath, 'utf-8');

    // Step 1: Compact the source code (strip comments, collapse blanks)
    const compacted = compactCode(source);
    expect(compacted.length).toBeLessThanOrEqual(source.length);

    // Step 2: Find a symbol and summarize it
    const symbols = store.getSymbolsByName('main');
    expect(symbols.length).toBeGreaterThan(0);
    const mainSymbol = symbols[0];

    const summary = await summarizeSymbol(mainSymbol.id, store);
    expect(summary.complexity.lines).toBeGreaterThan(0);

    // Step 3: Prune context around the symbol
    const pruned = await pruneContext(source, indexPath, mainSymbol.id, store);
    expect(pruned.keptLines).toBeLessThanOrEqual(pruned.totalLines);

    // Step 4: Compress the tool response
    const compressed = compressToolResponse('get_context', {
      filePath: indexPath,
      language: 'typescript',
      content: pruned.content,
      totalLines: pruned.totalLines,
      symbolsInRange: [{ id: mainSymbol.id, name: mainSymbol.name, kind: mainSymbol.kind }],
    });

    // Verify compression pipeline produces expected output
    expect(compressed._meta).toBeDefined();
    expect(compressed._meta.reduction).toBeDefined();
    // The compressed tokens should be less or equal to original
    expect(compressed._meta.compressedTokens).toBeLessThanOrEqual(compressed._meta.originalTokens);

    // All 4 stages executed successfully
    expect(typeof compacted).toBe('string');
    expect(summary.signature).toBeTruthy();
    expect(pruned.prunedSections).toBeDefined();
    expect(compressed._meta.layers).toContain('compact');

    store.close();
  }, 30000);
});
