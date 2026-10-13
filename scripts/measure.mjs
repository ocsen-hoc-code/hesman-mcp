#!/usr/bin/env node
/**
 * Measures Hesman the way an agent experiences it: it starts the built server
 * (`dist/index.js`) over stdio, lets it index a project, then calls every tool
 * through MCP and records
 *
 *   - time to the MCP handshake and time until the index is ready,
 *   - index size on disk and the server's memory (physical footprint and RSS),
 *   - per tool: latency seen by the client (median, p95) and the tokens of the
 *     response next to the tokens of the plain payload (`_meta`).
 *
 * Usage:
 *   npm run build
 *   node scripts/measure.mjs [--project <dir>] [--iterations 100] [--no-semantic]
 *                            [--json <file>] [--markdown <file>]
 *
 * Without `--project` it measures a clean export of this repository at HEAD
 * (`git archive`), so untracked files and `node_modules` are not part of it.
 * The index goes to a temporary data directory; nothing is written into the
 * measured project or into the repository's own `.hesman/`. Run it on an idle
 * machine: every number depends on the hardware and on what else is running.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'dist', 'index.js');

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}
const flag = (name) => process.argv.includes(name);

const iterations = Number(option('--iterations', '100'));
const semantic = !flag('--no-semantic');

/** A clean copy of the repository at HEAD, without anything untracked. */
function exportRepository() {
  const dir = mkdtempSync(join(tmpdir(), 'hesman-measure-src-'));
  const archive = join(dir, 'head.tar');
  execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', archive, 'HEAD']);
  const project = join(dir, 'project');
  mkdirSync(project);
  execFileSync('tar', ['-xf', archive, '-C', project]);
  return project;
}

function directorySize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? directorySize(path) : statSync(path).size;
  }
  return total;
}

/** Resident memory of a process in MB, or null where `ps` is not available. */
function rssMb(pid) {
  try {
    const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf-8' }).trim());
    return Math.round((kb / 1024) * 10) / 10;
  } catch {
    return null;
  }
}

/**
 * Memory the process alone is responsible for, in MB: the "physical footprint"
 * on macOS (what Activity Monitor shows), private pages on Linux. RSS is
 * larger because it also counts shared library code mapped from disk. Null
 * where neither source is available.
 */
function footprintMb(pid) {
  try {
    if (platform() === 'darwin') {
      const out = execFileSync('vmmap', ['--summary', String(pid)], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      const match = /Physical footprint:\s+([\d.]+)([KMG])/.exec(out);
      if (!match) return null;
      const scale = { K: 1 / 1024, M: 1, G: 1024 }[match[2]];
      return Math.round(Number(match[1]) * scale * 10) / 10;
    }
    const rollup = execFileSync('cat', [`/proc/${pid}/smaps_rollup`], { encoding: 'utf-8' });
    const kb = [...rollup.matchAll(/^Private_(?:Clean|Dirty):\s+(\d+) kB/gm)].reduce((sum, m) => sum + Number(m[1]), 0);
    return Math.round((kb / 1024) * 10) / 10;
  } catch {
    return null;
  }
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

async function main() {
  const project = resolve(option('--project', '') || exportRepository());
  const dataDir = mkdtempSync(join(tmpdir(), 'hesman-measure-data-'));

  const args = [SERVER, '--project-root', project, '--no-watch', '--data-dir', dataDir];
  if (!semantic) args.push('--no-semantic');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    env: { ...process.env, HESMAN_GRAMMARS_OFFLINE: '1', HESMAN_LOG_LEVEL: 'error' },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'hesman-measure', version: '1.0.0' }, { capabilities: {} });

  const call = async (name, toolArgs) => {
    const started = performance.now();
    const result = await client.callTool({ name, arguments: toolArgs });
    const ms = performance.now() - started;
    const text = result.content?.[0]?.text ?? '';
    return { ms, text, isError: result.isError === true, body: text ? JSON.parse(text) : {} };
  };

  const startedAt = performance.now();
  await client.connect(transport);
  const handshakeMs = performance.now() - startedAt;
  const atHandshake = { rssMb: rssMb(transport.pid), footprintMb: footprintMb(transport.pid) };

  // Wait until the background startup (model load + index) has finished.
  let status;
  for (;;) {
    status = (await call('index_status', {})).body;
    const modelSettled = !semantic || status.health?.embeddingModelLoaded || status.health?.embeddingModelError;
    if (status.indexing && !status.indexing.inProgress && status.lastFullIndexTime && modelSettled) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const readyMs = performance.now() - startedAt;
  const afterIndex = { rssMb: rssMb(transport.pid), footprintMb: footprintMb(transport.pid) };

  // Targets: a symbol with callers and callees, and the file that defines it.
  const found = (await call('find_symbol', { name: 'indexProject', matchMode: 'exact' })).body;
  const target = (found.symbols ?? found.results ?? [])[0];
  if (!target) throw new Error('The measured project has no symbol named indexProject; pass a project that has one or edit the targets.');
  const file = target.filePath;
  const line = target.startLine ?? target.line;

  const cases = [
    ['find_symbol', 'exact name', { name: 'indexProject', matchMode: 'exact' }],
    ['find_symbol', 'prefix "index"', { name: 'index', matchMode: 'prefix', topK: 20 }],
    ['find_symbol', 'fuzzy "parse file"', { name: 'parse file', matchMode: 'fuzzy', topK: 20 }],
    ['get_file_structure', 'one source file', { filePath: file }],
    ['get_context', 'function ±5 lines, compact', { filePath: file, startLine: line }],
    ['get_context', 'function ±40 lines, compact', { filePath: file, startLine: line, contextLines: 40 }],
    ['get_context', 'function ±5 lines, full', { filePath: file, startLine: line, mode: 'full' }],
    ['get_callers', 'callers of indexProject', { symbolId: target.id }],
    ['get_callees', 'callees of indexProject', { symbolId: target.id }],
    ['get_references', 'references to indexProject', { symbolId: target.id }],
    ['impact_analysis', 'delete indexProject', { symbolId: target.id, changeType: 'delete' }],
    ['list_dependencies', 'imports of one file', { filePath: file }],
    ['find_pattern', 'console.$M($$$A) in typescript', { pattern: 'console.$M($$$A)', language: 'typescript' }],
  ];
  if (semantic && status.health?.embeddingModelLoaded) {
    cases.push(['semantic_search', '"where are files hashed to skip unchanged ones"', { query: 'where are files hashed to skip unchanged ones' }]);
  }

  const tools = [];
  for (const [tool, label, toolArgs] of cases) {
    const first = await call(tool, toolArgs);
    if (first.isError) {
      tools.push({ tool, label, error: first.body?.error?.message ?? first.text.slice(0, 200) });
      continue;
    }
    for (let i = 0; i < 5; i++) await call(tool, toolArgs);
    const times = [];
    let last = first;
    for (let i = 0; i < iterations; i++) {
      last = await call(tool, toolArgs);
      times.push(last.ms);
    }
    times.sort((a, b) => a - b);
    const meta = last.body._meta ?? {};
    tools.push({
      tool,
      label,
      medianMs: round(quantile(times, 0.5)),
      p95Ms: round(quantile(times, 0.95)),
      responseBytes: Buffer.byteLength(last.text),
      plainTokens: meta.originalTokens ?? null,
      returnedTokens: meta.compressedTokens ?? null,
      reduction: meta.reduction ?? null,
      layers: meta.layers ?? [],
    });
  }

  const afterQueries = { rssMb: rssMb(transport.pid), footprintMb: footprintMb(transport.pid) };
  await client.close();

  const report = {
    measuredAt: new Date().toISOString(),
    machine: {
      platform: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      memoryGb: round(totalmem() / 2 ** 30, 0),
      node: process.version,
    },
    commit: execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim(),
    project: option('--project', '') ? project : 'this repository at HEAD (git archive)',
    semantic,
    iterations,
    startup: { handshakeMs: round(handshakeMs, 0), indexReadyMs: round(readyMs, 0) },
    index: {
      files: status.totalFiles,
      symbols: status.totalSymbols,
      relations: status.totalRelations,
      textFiles: status.textTier?.files ?? 0,
      textChunks: status.textTier?.chunks ?? 0,
      vectors: status.health?.zvecDocCount ?? 0,
      filesPerSecond: round((status.totalFiles + (status.textTier?.files ?? 0)) / (readyMs / 1000), 0),
      diskMb: round(directorySize(dataDir) / 2 ** 20, 1),
    },
    memory: { atHandshake, afterIndex, afterQueries },
    tools,
  };

  const jsonPath = option('--json', '');
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  const markdownPath = option('--markdown', '');
  if (markdownPath) writeFileSync(markdownPath, renderMarkdown(report));
  console.log(JSON.stringify(report, null, 2));
}

function renderMarkdown(r) {
  const row = (t) =>
    t.error
      ? `| \`${t.tool}\` | ${t.label} | error: ${t.error} | | | | |`
      : `| \`${t.tool}\` | ${t.label} | ${t.medianMs} | ${t.p95Ms} | ${t.plainTokens ?? '–'} | ${t.returnedTokens ?? '–'} | ${t.reduction ?? '–'} |`;
  return [
    `Measured ${r.measuredAt.slice(0, 10)} at commit \`${r.commit}\` on ${r.machine.cpu} (${r.machine.cores} cores, ${r.machine.memoryGb} GB), ${r.machine.platform}, Node ${r.machine.node}.`,
    `Project: ${r.project}; semantic search ${r.semantic ? 'on' : 'off'}; ${r.iterations} calls per row.`,
    '',
    '| Startup and index | Value |',
    '|---|---:|',
    `| MCP handshake answered after | ${r.startup.handshakeMs} ms |`,
    `| Index ready after (model load + scan + parse + embed) | ${r.startup.indexReadyMs} ms |`,
    `| Files with symbols / text files | ${r.index.files} / ${r.index.textFiles} |`,
    `| Symbols / relations | ${r.index.symbols} / ${r.index.relations} |`,
    `| Vectors | ${r.index.vectors} |`,
    `| Files per second, whole startup | ${r.index.filesPerSecond} |`,
    `| Index on disk | ${r.index.diskMb} MB |`,
    `| Server memory at the handshake: footprint / RSS | ${r.memory.atHandshake.footprintMb ?? '–'} MB / ${r.memory.atHandshake.rssMb} MB |`,
    `| Server memory after indexing: footprint / RSS | ${r.memory.afterIndex.footprintMb ?? '–'} MB / ${r.memory.afterIndex.rssMb} MB |`,
    `| Server memory after the queries: footprint / RSS | ${r.memory.afterQueries.footprintMb ?? '–'} MB / ${r.memory.afterQueries.rssMb} MB |`,
    '',
    '| Tool | Call | Median ms | p95 ms | Plain tokens | Returned tokens | Reduction |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...r.tools.map(row),
    '',
  ].join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
