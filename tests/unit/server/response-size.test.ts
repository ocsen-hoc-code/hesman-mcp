import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BENCH_FIXTURE, SCENARIOS, measureScenarios, openBench, type Bench, type ScenarioResult } from '../../perf/response-tokens.js';

/**
 * Regression guard for the token benchmark (`scripts/bench-responses.ts`, M4-01).
 * The numbers are not pinned: the plain payload carries absolute paths, so the
 * percentages move with the checkout location. The guarantees are pinned.
 */

/** A list of 10 rows or more must save at least this much against its plain payload. */
const MIN_SAVED_PCT_FOR_LISTS = 25;

describe('token benchmark guarantees (M4-01)', () => {
  let bench: Bench;
  let results: ScenarioResult[];

  beforeAll(async () => {
    bench = await openBench(BENCH_FIXTURE);
    results = await measureScenarios(bench, SCENARIOS);
  });

  afterAll(() => bench.close());

  it('runs every scenario without an error answer', () => {
    expect(results.filter((r) => r.isError).map((r) => r.id)).toEqual([]);
  });

  it('no response is larger than its plain payload', () => {
    for (const result of results) {
      expect(result.tokens, result.id).toBeLessThanOrEqual(result.plainTokens);
    }
  });

  it('each list and call-graph tool has a list of 10 rows or more, and saves at least the threshold on it', () => {
    const lists = results.filter((r) => r.rows >= 10);
    expect(new Set(lists.map((r) => r.tool))).toEqual(
      new Set(['find_symbol', 'get_references', 'get_callers', 'get_callees', 'get_file_structure', 'list_dependencies', 'impact_analysis']),
    );
    for (const result of lists) {
      expect(result.savedPct, result.id).toBeGreaterThanOrEqual(MIN_SAVED_PCT_FOR_LISTS);
    }
  });

  it('reports a reduction that is never negative', () => {
    for (const result of results) {
      if (result.reported !== null) expect(parseFloat(result.reported), result.id).toBeGreaterThanOrEqual(0);
    }
  });
});
