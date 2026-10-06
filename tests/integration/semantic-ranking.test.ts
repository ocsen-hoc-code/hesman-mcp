/**
 * Labeled ranking evaluation for semantic_search (M0-16).
 *
 * Indexes `tests/fixtures/semantic-ranking` (a copy of polyglot-basic plus a few
 * realistic functions) with the real embedding model and runs every labeled
 * query through the real `semantic_search` tool handler. Reports hit@3 and MRR
 * and asserts thresholds. Runs offline once the model is cached; skipped when
 * the model cannot be loaded.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { McpServer, ToolHandler } from '../../src/server/mcp-server.js';
import { SqliteStore } from '../../src/stores/sqlite.js';
import { ZVecStore } from '../../src/stores/zvec.js';
import { initEmbedding } from '../../src/stores/embedding.js';
import { indexProject } from '../../src/indexing/index-coordinator.js';
import { registerSemanticSearchTool } from '../../src/server/tools/semantic-search.js';
import { defaultConfig } from '../../src/config/defaults.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'semantic-ranking');

interface LabeledQuery {
  query: string;
  /** Any of these symbol names counts as a relevant hit. */
  expected: string[];
}

/**
 * The labeled set. Some queries share words with the target's name, others are
 * paraphrases that share none, so both lexical and semantic matching are exercised.
 */
const LABELED_QUERIES: LabeledQuery[] = [
  { query: 'format a person name for a greeting', expected: ['GoFormatName', 'py_format_name', 'tsFormatName'] },
  { query: 'trim whitespace around a name', expected: ['GoFormatName', 'py_format_name', 'tsFormatName'] },
  { query: 'build a greeting message', expected: ['GoGreet', 'py_greet', 'tsGreet'] },
  { query: 'program entry point', expected: ['main', 'tsMain', 'py_main'] },
  { query: 'compute the total price of items in a shopping cart', expected: ['calculateCartTotal'] },
  { query: 'sum prices multiplied by quantities', expected: ['calculateCartTotal'] },
  { query: 'apply a percentage discount to an amount', expected: ['applyDiscount'] },
  { query: 'read settings from a JSON file', expected: ['load_config'] },
  { query: 'check whether an email address is valid', expected: ['isValidEmail'] },
  { query: 'turn a title into a lowercase hyphenated URL string', expected: ['slugify'] },
  { query: 'retry an operation with exponential backoff', expected: ['RetryWithBackoff'] },
  { query: 'get query string parameters from an HTTP request', expected: ['ParseQueryParams'] },
  // Lexical decoys: a query word also appears in the name of a wrong symbol.
  { query: 'reduce the total price by a percentage', expected: ['applyDiscount'] },
  { query: 'validate the format of an email address', expected: ['isValidEmail'] },
];

/** Variables declared inside a function body in the fixture (never module-level there). */
const FUNCTION_LOCALS = ['total', 'item', 'clamped', 'delay', 'err', 'i', 'out', 'key', 'values', 'lowered'];

const HIT_AT_3_THRESHOLD = 1.0;
const MRR_THRESHOLD = 0.9;

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };
interface ResultRow { name: string; score: number; matchType: string }

let modelError: string | null = null;
try {
  await initEmbedding(defaultConfig.semanticSearch.embeddingModel);
} catch (err) {
  modelError = err instanceof Error ? err.message : String(err);
}
if (modelError) {
  console.warn(`[semantic-ranking] skipped: embedding model could not be loaded (${modelError})`);
}

describe.skipIf(modelError !== null)('semantic_search ranking evaluation', () => {
  let dataDir: string;
  let sqlite: SqliteStore;
  let zvec: ZVecStore;
  let handler: ToolHandler;

  async function search(query: string, topK = 10): Promise<ResultRow[]> {
    const result = (await handler({ query, topK })) as ToolResult;
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text ?? '{}') as { results: ResultRow[] };
    return body.results;
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(resolve(tmpdir(), 'hesman-ranking-'));
    sqlite = new SqliteStore(dataDir);
    sqlite.open();
    zvec = new ZVecStore(dataDir);
    zvec.open();
    await indexProject(FIXTURE_DIR, sqlite, defaultConfig, zvec);

    const server = {
      registerTool(_name: string, _description: string, _schema: object, h: ToolHandler) {
        handler = h;
      },
    } as unknown as McpServer;
    registerSemanticSearchTool(server, zvec, defaultConfig);
  }, 120000);

  afterAll(() => {
    zvec?.close();
    sqlite?.close();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('meets the hit@3 and MRR thresholds on the labeled query set', async () => {
    let hits = 0;
    let reciprocalRankSum = 0;
    const lines: string[] = [];

    for (const { query, expected } of LABELED_QUERIES) {
      const rows = await search(query);
      const rank = rows.findIndex(r => expected.includes(r.name)) + 1;
      if (rank >= 1 && rank <= 3) hits++;
      if (rank >= 1) reciprocalRankSum += 1 / rank;
      const top3 = rows.slice(0, 3).map(r => `${r.name}(${r.score.toFixed(3)})`).join(', ');
      lines.push(`  rank=${rank || '-'}  "${query}" -> ${top3}`);
    }

    const hitAt3 = hits / LABELED_QUERIES.length;
    const mrr = reciprocalRankSum / LABELED_QUERIES.length;
    console.log(`[semantic-ranking] hit@3=${hitAt3.toFixed(3)} MRR=${mrr.toFixed(3)}\n${lines.join('\n')}`);

    expect(hitAt3).toBeGreaterThanOrEqual(HIT_AT_3_THRESHOLD);
    expect(mrr).toBeGreaterThanOrEqual(MRR_THRESHOLD);
  }, 60000);

  it('ranks only *FormatName / *Greet functions in the top 3 for the smoke-test query, at least one *FormatName', async () => {
    const top3 = (await search('format a person name for a greeting')).slice(0, 3).map(r => r.name);
    const formatName = ['GoFormatName', 'py_format_name', 'tsFormatName'];
    const greet = ['GoGreet', 'py_greet', 'tsGreet'];
    for (const name of top3) {
      expect([...formatName, ...greet]).toContain(name);
    }
    expect(top3.some(name => formatName.includes(name))).toBe(true);
  }, 60000);

  it('never returns a function-local variable for the labeled queries', async () => {
    for (const { query } of LABELED_QUERIES) {
      const names = (await search(query)).map(r => r.name);
      expect(names.filter(name => FUNCTION_LOCALS.includes(name)), query).toEqual([]);
    }
  }, 60000);

  it('keeps every score in [0, 1]', async () => {
    for (const { query } of LABELED_QUERIES) {
      for (const row of await search(query)) {
        expect(row.score).toBeGreaterThanOrEqual(0);
        expect(row.score).toBeLessThanOrEqual(1);
      }
    }
  }, 60000);
});
