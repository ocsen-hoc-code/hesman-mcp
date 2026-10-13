/**
 * Token benchmark for the list and call-graph tools (M4-01).
 *
 *   npx tsx scripts/bench-responses.ts            # the committed fixture (tests/fixtures/response-bench)
 *   npx tsx scripts/bench-responses.ts <root>     # any project, e.g. this repository's src/
 *
 * Prints one row per scenario: rows returned, tokens of the plain payload
 * (`format: "full"`), tokens of the default response, the saving and the
 * `_meta.reduction` the tool reports. See tests/perf/response-tokens.ts.
 */
import { resolve } from 'node:path';
import {
  BENCH_FIXTURE,
  formatTable,
  measureScenarios,
  openBench,
  SCENARIOS,
} from '../tests/perf/response-tokens.js';

const root = resolve(process.argv[2] ?? BENCH_FIXTURE);
const bench = await openBench(root);
try {
  const results = await measureScenarios(bench, SCENARIOS);
  console.log(`project: ${root}`);
  console.log(formatTable(results));
  const failed = results.filter((r) => r.isError);
  if (failed.length > 0) {
    console.log(`\nscenarios that returned an error: ${failed.map((r) => r.id).join(', ')}`);
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
  }
} finally {
  bench.close();
}
