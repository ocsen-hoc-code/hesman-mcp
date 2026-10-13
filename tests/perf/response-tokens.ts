/**
 * Token benchmark for the list and call-graph tools (M4-01).
 *
 * Indexes a project in-process, runs every scenario through the real tool
 * handlers and measures each response with the estimator `_meta` uses
 * (`estimateTokens`: 4 characters per token) over the full response text,
 * `_meta` included, because that is what the agent reads.
 *
 * `plain` is the same call with `format: "full"` (the plain payload). Scenarios
 * whose tool does not take `format` are their own plain payload.
 *
 * Deterministic: the fixture and the arguments are fixed; no network, no model,
 * no worker threads. `semantic_search` and `find_pattern` are not measured
 * (they need the vector store or a worker that loads `dist/`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStore } from '../../src/stores/sqlite.js';
import { indexProject } from '../../src/indexing/index-coordinator.js';
import { defaultConfig } from '../../src/config/defaults.js';
import type { HesmanConfig } from '../../src/config/schema.js';
import type { McpServer, ToolHandler } from '../../src/server/mcp-server.js';
import { registerAllTools } from '../../src/server/tools/index.js';
import { estimateTokens } from '../../src/server/response-compressor.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BENCH_FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'response-bench');

export interface Scenario {
  /** Stable label used in the table and in tests. */
  id: string;
  tool: string;
  /** Arguments without `format`; the benchmark adds `format: "full"` for the plain run. */
  args: Record<string, unknown>;
  /** Symbol names the scenario needs: `symbolId` placeholders are resolved from the index. */
  symbolName?: string;
}

/**
 * The scenarios. `symbolName` is looked up in the index (exact match) and its id
 * replaces `symbolId` in `args`.
 */
export const SCENARIOS: Scenario[] = [
  { id: 'find_symbol prefix handleItem (10 rows)', tool: 'find_symbol', args: { name: 'handleItem', matchMode: 'prefix', topK: 50 } },
  { id: 'find_symbol prefix step (20 rows)', tool: 'find_symbol', args: { name: 'step', matchMode: 'prefix', topK: 50 } },
  { id: 'find_symbol exact hub (1 row)', tool: 'find_symbol', args: { name: 'hub', matchMode: 'exact' } },
  { id: 'get_references hub (calls + imports)', tool: 'get_references', args: { topK: 200 }, symbolName: 'hub' },
  { id: 'get_references Registry (small)', tool: 'get_references', args: { topK: 200 }, symbolName: 'Registry' },
  { id: 'get_callers hub depth 1', tool: 'get_callers', args: { maxDepth: 1, topK: 200 }, symbolName: 'hub' },
  { id: 'get_callers hub depth 2', tool: 'get_callers', args: { maxDepth: 2, topK: 200 }, symbolName: 'hub' },
  { id: 'get_callers reportFeature1 (none)', tool: 'get_callers', args: { maxDepth: 1, topK: 50 }, symbolName: 'reportFeature1' },
  { id: 'get_callees runAll (10 rows)', tool: 'get_callees', args: { maxDepth: 1, topK: 200 }, symbolName: 'runAll' },
  { id: 'get_callees handleItem1 (2 rows)', tool: 'get_callees', args: { maxDepth: 1, topK: 50 }, symbolName: 'handleItem1' },
  { id: 'get_file_structure large.ts (40 symbols)', tool: 'get_file_structure', args: { filePath: 'src/features/large.ts' } },
  { id: 'get_file_structure feature-1.ts (5 symbols)', tool: 'get_file_structure', args: { filePath: 'src/features/feature-1.ts' } },
  { id: 'list_dependencies index.ts (10 imports)', tool: 'list_dependencies', args: { filePath: 'src/features/index.ts' } },
  { id: 'list_dependencies hub.ts imported_by (0 rows, see notes)', tool: 'list_dependencies', args: { filePath: 'src/core/hub.ts', direction: 'imported_by' } },
  { id: 'list_dependencies project-wide', tool: 'list_dependencies', args: {} },
  { id: 'impact_analysis hub rename', tool: 'impact_analysis', args: { changeType: 'rename', newName: 'double', maxFiles: 50 }, symbolName: 'hub' },
  { id: 'get_context feature-1.ts lines 3-12', tool: 'get_context', args: { filePath: 'src/features/feature-1.ts', startLine: 3, endLine: 12, contextLines: 2 } },
  { id: 'index_status', tool: 'index_status', args: {} },
];

export interface ScenarioResult {
  id: string;
  tool: string;
  rows: number;
  /** Tokens of the default response (what the agent reads), `_meta` included. */
  tokens: number;
  /** Tokens of the same call with `format: "full"`, the plain payload. */
  plainTokens: number;
  /** `_meta.reduction` as the tool reports it, or `null` when absent. */
  reported: string | null;
  /** Whether the default response is smaller than the plain payload. */
  savedPct: number;
  isError: boolean;
}

export interface Bench {
  tools: Map<string, ToolHandler>;
  store: SqliteStore;
  config: HesmanConfig;
  close(): void;
}

/**
 * Index `projectRoot` into a temporary data directory (never inside the project)
 * and register every tool against it.
 */
export async function openBench(projectRoot: string): Promise<Bench> {
  const dataDir = mkdtempSync(join(tmpdir(), 'hesman-response-bench-'));
  const config: HesmanConfig = { ...defaultConfig, projectRoot };
  const store = new SqliteStore(dataDir);
  store.open();
  await indexProject(projectRoot, store, config);

  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _description: string, _schema: object, handler: ToolHandler) {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  registerAllTools(server, store, undefined, config);

  return {
    tools,
    store,
    config,
    close() {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function textOf(result: unknown): { text: string; isError: boolean } {
  const r = result as { content: Array<{ text?: string }>; isError?: boolean };
  return { text: r.content[0]?.text ?? '', isError: r.isError === true };
}

/** The count of rows a list response carries, in either format (0 when it has no list). */
function rowsOf(payload: Record<string, unknown>): number {
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.files)) {
    return (payload.files as Array<{ rows?: unknown[] }>).reduce((sum, f) => sum + (f.rows?.length ?? 0), 0);
  }
  for (const key of ['symbols', 'references', 'callers', 'callees', 'dependencies', 'impactedFiles']) {
    const value = payload[key];
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

async function runOnce(bench: Bench, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const handler = bench.tools.get(tool);
  if (!handler) throw new Error(`tool not registered: ${tool}`);
  return textOf(await handler(args));
}

/** Resolve a symbol name to its id in the index, or throw. */
export function symbolIdOf(bench: Bench, name: string): string {
  const [symbol] = bench.store.getSymbolsByName(name, undefined, undefined, 1, 'exact');
  if (!symbol) throw new Error(`symbol not indexed: ${name}`);
  return symbol.id;
}

/** Run every scenario and return the measurements. */
export async function measureScenarios(bench: Bench, scenarios: Scenario[] = SCENARIOS): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const args: Record<string, unknown> = { ...scenario.args };
    if (scenario.symbolName) args.symbolId = symbolIdOf(bench, scenario.symbolName);

    const plainRun = await runOnce(bench, scenario.tool, { ...args, format: 'full' });
    const run = await runOnce(bench, scenario.tool, args);
    const payload = run.isError ? {} : (JSON.parse(run.text) as Record<string, unknown>);
    const reported = (payload._meta as { reduction?: string } | undefined)?.reduction ?? null;
    const tokens = estimateTokens(run.text);
    const plainTokens = estimateTokens(plainRun.text);
    results.push({
      id: scenario.id,
      tool: scenario.tool,
      rows: rowsOf(payload),
      tokens,
      plainTokens,
      reported,
      savedPct: plainTokens === 0 ? 0 : Math.round((1 - tokens / plainTokens) * 1000) / 10,
      isError: run.isError,
    });
  }
  return results;
}

/** Fixed-width text table of the results. */
export function formatTable(results: ScenarioResult[]): string {
  const header = ['scenario', 'rows', 'plain', 'response', 'saved', 'reported'];
  const lines = results.map((r) => [
    r.id,
    String(r.rows),
    String(r.plainTokens),
    String(r.tokens),
    `${r.savedPct.toFixed(1)}%`,
    r.reported ?? '-',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const row = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [row(header), row(widths.map((w) => '-'.repeat(w))), ...lines.map(row)].join('\n');
}
