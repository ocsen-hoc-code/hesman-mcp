import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { RotatingFile, readRotatedLines, rotatedPath } from './rotating-file.js';

/**
 * The tool-call log: one JSON line per MCP tool call, written by the server
 * into `<dataDir>/tool-calls.jsonl` and read by `hesman ui` from another
 * process.
 *
 * Why a JSONL file and not a SQLite table: recording happens on the tool-call
 * path, and an `O_APPEND` write of one short line cannot wait on a database
 * lock held by the indexer, needs no second connection or schema migration,
 * and a reader in another process never blocks the writer. The data is a
 * bounded, time-ordered log that is only ever read whole and newest-first, so
 * a query engine adds nothing. The size is bounded by `RotatingFile`: one
 * current and one rotated file of at most `TOOL_CALL_LOG_MAX_BYTES` each
 * (about 20,000 calls in total).
 *
 * What is stored: the tool name, timing, outcome, the token counts of `_meta`
 * and a short preview of the arguments. Responses are never stored.
 */

export const TOOL_CALL_LOG_FILE = 'tool-calls.jsonl';
export const TOOL_CALL_LOG_MAX_BYTES = 2 * 1024 * 1024;

const PREVIEW_STRING_CHARS = 80;
const PREVIEW_ARRAY_ITEMS = 5;
const PREVIEW_DEPTH = 2;
const PREVIEW_TOTAL_CHARS = 300;
const TOOL_NAME_CHARS = 100;

export interface ToolCallRecord {
  /** Grows with every call; the paging cursor of `readToolCalls`. */
  id: number;
  /** ISO 8601 time the call finished. */
  time: string;
  tool: string;
  durationMs: number;
  ok: boolean;
  /** Error code of a failed call (`server/error-codes.ts`), else `null`. */
  errorCode: string | null;
  /** `_meta.originalTokens` of the response; `null` when it has no `_meta`. */
  originalTokens: number | null;
  /** `_meta.compressedTokens` of the response; `null` when it has no `_meta`. */
  compressedTokens: number | null;
  /** JSON text of the arguments with long values cut; at most ~300 characters. */
  argsPreview: string;
}

/** What `ToolCallLog.record` needs to know about one finished call. */
export interface ToolCallInput {
  tool: string;
  args: unknown;
  durationMs: number;
  result: { content: Array<{ type: string; text?: string }>; isError?: boolean };
}

/** Anything that can take finished tool calls (the server only knows this). */
export interface ToolCallRecorder {
  record(call: ToolCallInput): void;
}

function ellipsize(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function previewValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return ellipsize(value, PREVIEW_STRING_CHARS);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= PREVIEW_DEPTH) return Array.isArray(value) ? '[…]' : '{…}';
  if (Array.isArray(value)) {
    const items = value.slice(0, PREVIEW_ARRAY_ITEMS).map((item) => previewValue(item, depth + 1));
    if (value.length > PREVIEW_ARRAY_ITEMS) items.push('…');
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = previewValue(item, depth + 1);
  return out;
}

/**
 * A short, bounded rendering of tool arguments: strings are cut at 80
 * characters, arrays at 5 items, nesting at 2 levels, the whole at 300.
 */
export function buildArgsPreview(args: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(previewValue(args, 0));
  } catch {
    text = undefined;
  }
  return ellipsize(text ?? '', PREVIEW_TOTAL_CHARS);
}

function asTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Token counts from the `_meta` block of a tool response. The compressor adds
 * `_meta` as the last key, so only the tail of the text is parsed — a response
 * can be large and this runs on every call.
 */
function tokensOf(text: string): { originalTokens: number | null; compressedTokens: number | null } {
  const none = { originalTokens: null, compressedTokens: null };
  const marker = '"_meta":';
  const at = text.lastIndexOf(marker);
  if (at === -1 || !text.endsWith('}')) return none;
  try {
    const meta = JSON.parse(text.slice(at + marker.length, -1)) as Record<string, unknown> | null;
    if (meta === null || typeof meta !== 'object') return none;
    return {
      originalTokens: asTokenCount(meta.originalTokens),
      compressedTokens: asTokenCount(meta.compressedTokens),
    };
  } catch {
    return none;
  }
}

function errorCodeOf(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown } } | null;
    const code = parsed?.error?.code;
    return typeof code === 'string' ? code.slice(0, TOOL_NAME_CHARS) : null;
  } catch {
    return null;
  }
}

export interface ToolCallLogOptions {
  /** Rotation size of the file. Default `TOOL_CALL_LOG_MAX_BYTES`. */
  maxBytes?: number;
  /** Clock, for tests. */
  now?: () => number;
}

/** Bytes read from the end of a file to find its last record; a record is far shorter. */
const TAIL_BYTES = 8192;

/** The id of the last complete record in the file at `path`, or 0. Never throws. */
function lastIdIn(path: string): number {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf-8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const id = (JSON.parse(lines[i]) as { id?: unknown } | null)?.id;
        if (typeof id === 'number' && Number.isFinite(id)) return id;
      } catch {
        // an empty, cut or unfinished line
      }
    }
  } catch {
    // no file yet
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // nothing useful to do
      }
    }
  }
  return 0;
}

export class ToolCallLog implements ToolCallRecorder {
  private readonly file: RotatingFile;
  private readonly path: string;
  private readonly now: () => number;
  /** Microseconds since the epoch; the base of new ids. */
  private readonly nowMicros: () => number;
  /** `undefined` until the first record: the ids already in the file are read then. */
  private lastId: number | undefined;

  constructor(dataDir: string, options: ToolCallLogOptions = {}) {
    this.path = join(dataDir, TOOL_CALL_LOG_FILE);
    this.file = new RotatingFile(this.path, {
      maxBytes: options.maxBytes ?? TOOL_CALL_LOG_MAX_BYTES,
    });
    const injected = options.now;
    this.now = injected ?? Date.now;
    this.nowMicros = injected
      ? () => injected() * 1000
      : () => Math.floor((performance.timeOrigin + performance.now()) * 1000);
  }

  /**
   * Appends one call. Never throws and does no work proportional to the
   * response size beyond a tail search, so it cannot fail or slow a call.
   */
  record(call: ToolCallInput): void {
    try {
      const now = this.now();
      // Ids are microsecond timestamps, so calls of one millisecond stay apart and in order,
      // also across writers. A new writer (a restarted server) continues after the last
      // id in the file: the reader identifies a call by its id.
      this.lastId ??= Math.max(lastIdIn(this.path), lastIdIn(rotatedPath(this.path)));
      this.lastId = Math.max(this.lastId + 1, this.nowMicros());
      const isError = call.result?.isError === true;
      const text = call.result?.content?.[0]?.text ?? '';
      const record: ToolCallRecord = {
        id: this.lastId,
        time: new Date(now).toISOString(),
        tool: String(call.tool).slice(0, TOOL_NAME_CHARS),
        durationMs: Number.isFinite(call.durationMs) ? Math.round(call.durationMs * 100) / 100 : 0,
        ok: !isError,
        errorCode: isError ? errorCodeOf(text) : null,
        ...(isError ? { originalTokens: null, compressedTokens: null } : tokensOf(text)),
        argsPreview: buildArgsPreview(call.args),
      };
      this.file.append(JSON.stringify(record));
    } catch {
      // Observability must never break a tool call.
    }
  }

  close(): void {
    this.file.close();
  }
}

function parseRecord(line: string): ToolCallRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null; // e.g. a line that is still being written
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'number' || typeof r.time !== 'string' || typeof r.tool !== 'string') return null;
  return {
    id: r.id,
    time: r.time,
    tool: r.tool,
    durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
    ok: r.ok === true,
    errorCode: typeof r.errorCode === 'string' ? r.errorCode : null,
    originalTokens: asTokenCount(r.originalTokens),
    compressedTokens: asTokenCount(r.compressedTokens),
    argsPreview: typeof r.argsPreview === 'string' ? r.argsPreview : '',
  };
}

/** Every recorded call in `dataDir`, newest first. */
export function readAllToolCalls(dataDir: string): ToolCallRecord[] {
  const byId = new Map<number, ToolCallRecord>();
  for (const line of readRotatedLines(join(dataDir, TOOL_CALL_LOG_FILE))) {
    const record = parseRecord(line);
    if (record) byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

export interface ToolCallQuery {
  /** Page size. Default 50. */
  limit?: number;
  /** Only calls with an id below this one (the `nextBefore` of the previous page). */
  before?: number;
  /** Only calls of this tool. */
  tool?: string;
}

export interface ToolCallPage {
  calls: ToolCallRecord[];
  /** Pass as `before` for the next page; `null` when there are no older calls. */
  nextBefore: number | null;
}

export function readToolCalls(dataDir: string, query: ToolCallQuery = {}): ToolCallPage {
  const limit = query.limit ?? 50;
  let calls = readAllToolCalls(dataDir);
  if (query.tool) calls = calls.filter((c) => c.tool === query.tool);
  if (query.before !== undefined) {
    const before = query.before;
    calls = calls.filter((c) => c.id < before);
  }
  const page = calls.slice(0, limit);
  return { calls: page, nextBefore: calls.length > limit && page.length > 0 ? page[page.length - 1].id : null };
}

export interface ToolCallMetrics {
  summary: { calls: number; errors: number; p50Ms: number; p95Ms: number; tokensOriginal: number; tokensReturned: number };
  byTool: Array<{
    tool: string;
    calls: number;
    errors: number;
    avgMs: number;
    p95Ms: number;
    tokensOriginal: number;
    tokensReturned: number;
  }>;
  /** Equal time buckets covering the window, oldest first; `t` is the ISO start of the bucket. */
  series: Array<{ t: string; calls: number; errors: number; avgMs: number }>;
}

const MAX_SERIES_BUCKETS = 60;
const MIN_BUCKET_MS = 60_000;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Nearest-rank percentile of an ascending list; 0 for an empty list. */
function percentile(sortedAscending: number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(sortedAscending.length * fraction));
  return sortedAscending[rank - 1];
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Aggregates the calls of the last `windowMinutes` (ending at `now`). */
export function summarizeToolCalls(
  calls: readonly ToolCallRecord[],
  options: { windowMinutes: number; now?: number },
): ToolCallMetrics {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMinutes * 60_000;
  const bucketMs = Math.max(MIN_BUCKET_MS, Math.ceil(windowMs / MAX_SERIES_BUCKETS / MIN_BUCKET_MS) * MIN_BUCKET_MS);
  // Buckets are aligned to the clock so a refreshed chart does not shift.
  const firstBucket = Math.floor((now - windowMs) / bucketMs) * bucketMs;
  const bucketCount = Math.floor((now - firstBucket) / bucketMs) + 1;

  const buckets = Array.from({ length: bucketCount }, () => ({ calls: 0, errors: 0, totalMs: 0 }));
  const perTool = new Map<string, { durations: number[]; errors: number; tokensOriginal: number; tokensReturned: number }>();
  const durations: number[] = [];
  let errors = 0;
  let tokensOriginal = 0;
  let tokensReturned = 0;

  for (const call of calls) {
    const time = Date.parse(call.time);
    if (!Number.isFinite(time) || time <= now - windowMs || time > now) continue;

    durations.push(call.durationMs);
    if (!call.ok) errors++;
    tokensOriginal += call.originalTokens ?? 0;
    tokensReturned += call.compressedTokens ?? 0;

    let tool = perTool.get(call.tool);
    if (!tool) {
      tool = { durations: [], errors: 0, tokensOriginal: 0, tokensReturned: 0 };
      perTool.set(call.tool, tool);
    }
    tool.durations.push(call.durationMs);
    if (!call.ok) tool.errors++;
    tool.tokensOriginal += call.originalTokens ?? 0;
    tool.tokensReturned += call.compressedTokens ?? 0;

    const bucket = buckets[Math.floor((time - firstBucket) / bucketMs)];
    if (bucket) {
      bucket.calls++;
      bucket.totalMs += call.durationMs;
      if (!call.ok) bucket.errors++;
    }
  }

  durations.sort((a, b) => a - b);
  const byTool = [...perTool.entries()]
    .map(([tool, t]) => {
      const sorted = [...t.durations].sort((a, b) => a - b);
      return {
        tool,
        calls: sorted.length,
        errors: t.errors,
        avgMs: average(sorted),
        p95Ms: percentile(sorted, 0.95),
        tokensOriginal: t.tokensOriginal,
        tokensReturned: t.tokensReturned,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

  return {
    summary: {
      calls: durations.length,
      errors,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      tokensOriginal,
      tokensReturned,
    },
    byTool,
    series: buckets.map((b, i) => ({
      t: new Date(firstBucket + i * bucketMs).toISOString(),
      calls: b.calls,
      errors: b.errors,
      avgMs: b.calls === 0 ? 0 : round2(b.totalMs / b.calls),
    })),
  };
}
