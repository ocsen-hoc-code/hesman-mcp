/* global setTimeout, URL */
// Mock backend for `?mock=1`: a `fetch`-compatible function that answers every endpoint of the
// API contract from generated data, so the dashboard is fully usable without `hesman ui`.
// Scenarios (`?mock=1&scenario=<name>`): ready (default), indexing, empty, limited (what `hesman ui` reports
// next to a running MCP server), unauthorized, forbidden, offline.

import { TEXT_TIER, buildProject, emptyProject, fileEdges, languageStats, prng } from './project.js';
import { TOOLS, runMockTool } from './tools.js';

export const SCENARIOS = ['ready', 'indexing', 'empty', 'limited', 'unauthorized', 'forbidden', 'offline'];

const LIMITATIONS = [
  { feature: 'semantic_search', reason: 'The vector store is open in the MCP server of this project and cannot be shared with the dashboard.' },
  { feature: 'indexing_progress', reason: 'Indexing runs in the MCP server; the dashboard only sees what is already stored.' },
  { feature: 'writes', reason: 'The dashboard opens the index read-only.' },
];

const SLOT_MS = 10_000; // activity is generated per 10-second slot, seeded by the slot number
const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };
const TOOL_MIX = [
  ['find_symbol', 26, 4, 1.6], ['get_context', 22, 6, 9.5], ['semantic_search', 14, 42, 2.4], ['get_callers', 9, 3, 1],
  ['get_file_structure', 8, 5, 1], ['get_references', 7, 4, 1], ['find_pattern', 5, 60, 3.1], ['get_callees', 4, 3, 1],
  ['impact_analysis', 3, 9, 1.3], ['list_dependencies', 1, 6, 1], ['index_status', 1, 1, 1],
]; // tool, weight, typical ms, original/returned token ratio
const WATCHED = ['src/cart/cart.ts', 'src/checkout/payment.ts', 'worker/jobs/report.py', 'gateway/proxy.go', 'docs/checkout.md'];

function pickTool(r) {
  let roll = r * TOOL_MIX.reduce((sum, t) => sum + t[1], 0);
  return TOOL_MIX.find((t) => (roll -= t[1]) < 0) ?? TOOL_MIX[0];
}

/** The tool calls that "happened" in one slot. Same slot, same calls. */
function callsInSlot(slot, project) {
  const random = prng(slot * 7919 + 13);
  const busy = 0.35 + 0.3 * Math.sin(slot / 40); // activity comes in waves, like an agent session
  const calls = [];
  for (let k = 0; k < 3 && random() < busy; k++) {
    const [tool, , typicalMs, ratio] = pickTool(random());
    const failed = random() < 0.045;
    const durationMs = Number((typicalMs * (0.4 + random() * 1.4) * (random() < 0.06 ? 9 : 1)).toFixed(2));
    const compressedTokens = failed ? 28 : Math.round(90 + random() * 900);
    const subject = project.symbols[Math.floor(random() * project.symbols.length)];
    calls.push({
      id: `c${slot}-${k}`,
      time: new Date(slot * SLOT_MS + Math.floor(random() * SLOT_MS)).toISOString(),
      tool,
      durationMs,
      ok: !failed,
      errorCode: failed ? (random() < 0.5 ? 'SYMBOL_NOT_FOUND' : 'INVALID_INPUT') : null,
      originalTokens: failed || tool === 'index_status' ? compressedTokens : Math.round(compressedTokens * ratio),
      compressedTokens,
      argsPreview: JSON.stringify(tool.startsWith('get_c') || tool === 'impact_analysis' ? { symbolId: subject.id } : { name: subject.name }).slice(0, 80),
    });
  }
  return calls.sort((a, b) => (a.time < b.time ? 1 : -1));
}

function logsInSlot(slot, project) {
  const random = prng(slot * 104729 + 7);
  const entries = callsInSlot(slot, project).map((call) => {
    const fields = { tool: call.tool, durationMs: call.durationMs, callId: call.id };
    if (!call.ok) return { time: call.time, level: 'error', name: 'hesman:server', msg: `Tool call failed: ${call.tool}`, fields: { ...fields, code: call.errorCode } };
    if (call.durationMs > 150) return { time: call.time, level: 'warn', name: 'hesman:server', msg: `Slow tool call: ${call.tool}`, fields };
    return { time: call.time, level: 'info', name: 'hesman:server', msg: `Tool call completed: ${call.tool}`, fields: { ...fields, tokens: call.compressedTokens } };
  });
  if (random() < 0.3) {
    const path = WATCHED[Math.floor(random() * WATCHED.length)];
    const time = new Date(slot * SLOT_MS + 1234).toISOString();
    entries.push({ time, level: 'debug', name: 'hesman:watcher', msg: 'File watcher event', fields: { event: 'change', path } });
    entries.push({ time, level: 'info', name: 'hesman:indexer', msg: `Reindexed ${path}`, fields: { path, symbols: 3 + Math.floor(random() * 9), tookMs: Number((4 + random() * 30).toFixed(1)) } });
  }
  return entries.sort((a, b) => (a.time < b.time ? 1 : -1));
}

/** Items of the slots before `beforeSlot` (exclusive), newest first, looking back at most `maxSlots`. */
function collect(perSlot, beforeSlot, maxSlots, keep, limit) {
  const out = [];
  let slot = beforeSlot - 1;
  for (; slot > beforeSlot - 1 - maxSlots && out.length < limit; slot--) out.push(...perSlot(slot).filter(keep));
  return { items: out, nextSlot: slot + 1 };
}

const percentile = (sorted, p) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
const round = (n) => Number(n.toFixed(2));
const mean = (list) => (list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length);

function metrics(project, now, windowMinutes) {
  const windowMs = windowMinutes * 60_000;
  const calls = [];
  if (project.symbols.length > 0) {
    for (let slot = Math.floor((now - windowMs) / SLOT_MS); slot <= Math.floor(now / SLOT_MS); slot++) {
      calls.push(...callsInSlot(slot, project).filter((c) => Date.parse(c.time) > now - windowMs && Date.parse(c.time) <= now));
    }
  }
  const summarize = (list) => {
    const durations = list.map((c) => c.durationMs).sort((a, b) => a - b);
    return {
      calls: list.length,
      errors: list.filter((c) => !c.ok).length,
      avgMs: round(mean(durations)),
      p50Ms: round(percentile(durations, 0.5)),
      p95Ms: round(percentile(durations, 0.95)),
      tokensOriginal: list.reduce((n, c) => n + c.originalTokens, 0),
      tokensReturned: list.reduce((n, c) => n + c.compressedTokens, 0),
    };
  };
  const without = (row, key) => Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));
  const summary = without(summarize(calls), 'avgMs');
  const byTool = [...new Set(calls.map((c) => c.tool))]
    .map((tool) => {
      return { tool, ...without(summarize(calls.filter((c) => c.tool === tool)), 'p50Ms') };
    })
    .sort((a, b) => b.calls - a.calls);
  const bucketMs = Math.max(60_000, Math.ceil(windowMs / 60 / 60_000) * 60_000);
  const firstBucket = Math.floor((now - windowMs) / bucketMs) + 1;
  const series = [];
  for (let b = firstBucket; b <= Math.floor(now / bucketMs); b++) {
    const inBucket = calls.filter((c) => Math.floor(Date.parse(c.time) / bucketMs) === b);
    series.push({ t: new Date(b * bucketMs).toISOString(), calls: inBucket.length, errors: inBucket.filter((c) => !c.ok).length, avgMs: round(mean(inBucket.map((c) => c.durationMs))) });
  }
  return { summary, byTool, series };
}

function indexPayload(project, scenario, startedAt, now) {
  const filesTotal = project.files.length + (project.files.length > 0 ? TEXT_TIER.files : 0);
  const progress = scenario === 'indexing' ? Math.min(1, 0.2 + (now - startedAt) / 40_000) : 1;
  const resolving = scenario === 'indexing' && progress >= 1 && now - startedAt < 35_000;
  const inProgress = scenario === 'indexing' && (progress < 1 || resolving);
  const filesDone = Math.floor(filesTotal * progress);
  const part = (n) => Math.floor(n * progress);
  const languages = languageStats(project).map((l) => ({ ...l, files: Math.max(1, part(l.files)), symbols: part(l.symbols) }));
  const textTier = project.files.length === 0
    ? { files: 0, chunks: 0, languages: [] }
    : { files: part(TEXT_TIER.files), chunks: part(TEXT_TIER.chunks), languages: TEXT_TIER.languages.map((l) => ({ ...l, files: Math.max(1, part(l.files)), chunks: Math.max(1, part(l.chunks)) })) };
  return {
    totalFiles: part(project.files.length),
    indexedFiles: part(project.files.length),
    totalSymbols: part(project.symbols.length),
    totalRelations: part(project.edges.length),
    lastFullIndexTime: inProgress || project.files.length === 0 ? null : new Date(startedAt - 3_600_000).toISOString(),
    lastIncrementalIndexTime: null,
    pendingFiles: inProgress ? filesTotal - filesDone : 0,
    indexing: {
      inProgress,
      phase: inProgress ? (resolving ? 'resolving' : 'indexing') : 'ready',
      filesDone,
      filesTotal,
      startedAt: new Date(scenario === 'indexing' ? startedAt - 8_000 : startedAt - 3_612_000).toISOString(),
      error: null,
    },
    health: { sqliteOk: true, zvecOk: true, zvecDocCount: part(project.symbols.length) + textTier.chunks, embeddingModelLoaded: true, embeddingModelError: null },
    languages: project.files.length === 0 ? [] : languages,
    textTier,
  };
}

function neighborhood(project, symbolId, depth, limit) {
  const center = project.byId.get(symbolId);
  if (!center) return null;
  const picked = new Map();
  let frontier = [center.id];
  let truncated = false;
  for (let level = 0; level < depth; level++) {
    const next = [];
    for (const id of frontier) {
      for (const edge of project.edges) {
        const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
        if (other === null || other === center.id || picked.has(other)) continue;
        if (picked.size >= limit) truncated = true;
        else {
          picked.set(other, project.byId.get(other));
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  const inside = new Set([center.id, ...picked.keys()]);
  const node = ({ id, name, kind, filePath, startLine, language }) => ({ id, name, kind, filePath, startLine, language });
  return {
    center: node(center),
    nodes: [...picked.values()].map(node),
    edges: project.edges.filter((e) => inside.has(e.from) && inside.has(e.to)).map(({ from, to, kind, line }) => ({ from, to, kind, line })),
    truncated,
  };
}

const ok = (data) => ({ status: 200, body: { ok: true, data } });
const fail = (status, code, message) => ({ status, body: { ok: false, error: { code, message } } });
const numberParam = (params, name, fallback) => (params.has(name) && Number.isFinite(Number(params.get(name))) ? Number(params.get(name)) : fallback);

/**
 * @param options `{ scenario?, now?: () => number, delayMs? }`
 * @returns a function with the shape of `fetch(url, init)` that resolves to `{ status, ok, json() }`
 */
export function createMockFetch(options = {}) {
  const scenario = SCENARIOS.includes(options.scenario) ? options.scenario : 'ready';
  const now = options.now ?? (() => Date.now());
  const delayMs = options.delayMs ?? 120;
  const startedAt = now();
  const project = scenario === 'empty' ? emptyProject() : buildProject();
  const active = project.symbols.length > 0;
  const tools = scenario === 'limited' ? TOOLS.filter((tool) => tool.name !== 'semantic_search') : TOOLS;

  function route(method, path, params, body) {
    const t = now();
    const index = () => indexPayload(project, scenario, startedAt, t);
    if (method === 'POST' && path.startsWith('/api/tools/')) {
      const name = decodeURIComponent(path.slice('/api/tools/'.length));
      if (!TOOLS.some((tool) => tool.name === name)) return fail(404, 'NOT_FOUND', `Unknown tool: ${name}`);
      if (!tools.some((tool) => tool.name === name)) return fail(409, 'TOOL_UNAVAILABLE', `${name} is not available: ${LIMITATIONS[0].reason}`);
      const run = runMockTool(name, body?.args, project, index());
      return ok({ ...run, durationMs: round(0.6 + (JSON.stringify(run.result).length % 97) / 9) });
    }
    if (method !== 'GET') return fail(404, 'NOT_FOUND', `No route for ${method} ${path}`);
    switch (path) {
      case '/api/status':
        return ok({ version: '0.9.0-mock', projectRoot: '/Users/dev/code/harbor-shop', dataDir: '/Users/dev/code/harbor-shop/.hesman', serverTime: new Date(t).toISOString(), index: index(), limitations: scenario === 'limited' ? LIMITATIONS : [] });
      case '/api/metrics':
        return ok(metrics(project, t, Math.min(1440, Math.max(1, numberParam(params, 'windowMinutes', 60)))));
      case '/api/calls': {
        const limit = Math.max(1, Math.min(200, numberParam(params, 'limit', 50)));
        const before = params.get('before');
        const tool = params.get('tool');
        const keep = (c) => Date.parse(c.time) <= t && (!tool || c.tool === tool);
        let items = [];
        let nextSlot = Math.floor(t / SLOT_MS) + 1;
        if (active) {
          if (before) {
            const [slot, k] = before.slice(1).split('-').map(Number);
            items = callsInSlot(slot, project).filter(keep).filter((c) => Number(c.id.split('-')[1]) < k);
            nextSlot = slot;
          }
          const more = collect((s) => callsInSlot(s, project), nextSlot, 2160, keep, limit - items.length);
          items = [...items, ...more.items].slice(0, limit);
        }
        return ok({ calls: items, nextBefore: items.length === limit ? items[items.length - 1].id : null });
      }
      case '/api/logs': {
        const limit = Math.max(1, Math.min(1000, numberParam(params, 'limit', 200)));
        const minRank = LEVEL_RANK[params.get('level') ?? 'info'] ?? 1;
        const q = (params.get('q') ?? '').toLowerCase();
        const keep = (e) => Date.parse(e.time) <= t && LEVEL_RANK[e.level] >= minRank && (q === '' || `${e.msg} ${e.name} ${JSON.stringify(e.fields)}`.toLowerCase().includes(q));
        const beforeSlot = params.get('before') ? Number(params.get('before')) : Math.floor(t / SLOT_MS) + 1;
        const found = active ? collect((s) => logsInSlot(s, project), beforeSlot, 1080, keep, limit) : { items: [], nextSlot: 0 };
        return ok({ entries: found.items, nextBefore: found.items.length >= limit ? String(found.nextSlot) : null });
      }
      case '/api/graph/search': {
        const q = (params.get('q') ?? '').toLowerCase();
        const symbols = project.symbols
          .filter((s) => s.name.toLowerCase().includes(q))
          .filter((s) => (!params.get('kind') || s.kind === params.get('kind')) && (!params.get('language') || s.language === params.get('language')))
          .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
          .slice(0, numberParam(params, 'limit', 30))
          .map(({ id, name, kind, filePath, startLine, endLine, language, isExported }) => ({ id, name, kind, filePath, startLine, endLine, language, isExported }));
        return ok({ symbols });
      }
      case '/api/graph/neighborhood': {
        const hood = neighborhood(project, params.get('symbolId'), Math.max(1, Math.min(3, numberParam(params, 'depth', 1))), numberParam(params, 'limit', 80));
        return hood ? ok(hood) : fail(404, 'SYMBOL_NOT_FOUND', `Symbol not found: ${params.get('symbolId')}`);
      }
      case '/api/graph/files': {
        const limit = numberParam(params, 'limit', 200);
        const nodes = [...project.files].sort((a, b) => b.symbols - a.symbols).slice(0, limit);
        const ids = new Set(nodes.map((n) => n.id));
        return ok({ nodes, edges: fileEdges(project).filter((e) => ids.has(e.from) && ids.has(e.to)), truncated: project.files.length > limit });
      }
      case '/api/tools':
        return ok({ tools });
      default:
        return fail(404, 'NOT_FOUND', `No route for GET ${path}`);
    }
  }

  return async function mockFetch(url, init = {}) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (scenario === 'offline') throw new TypeError('Failed to fetch');
    const { pathname, searchParams } = new URL(url, 'http://127.0.0.1');
    let answer;
    if (scenario === 'unauthorized') answer = fail(401, 'UNAUTHORIZED', 'A valid token is required.');
    else if (scenario === 'forbidden') answer = fail(403, 'FORBIDDEN', 'Host or Origin not allowed.');
    else answer = route((init.method ?? 'GET').toUpperCase(), pathname, searchParams, init.body ? JSON.parse(init.body) : undefined);
    return { status: answer.status, ok: answer.status < 400, json: async () => answer.body };
  };
}
