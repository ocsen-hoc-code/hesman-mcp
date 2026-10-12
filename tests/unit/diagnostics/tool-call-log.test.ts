import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  TOOL_CALL_LOG_FILE,
  ToolCallLog,
  buildArgsPreview,
  readToolCalls,
  summarizeToolCalls,
  type ToolCallRecord,
} from '../../../src/diagnostics/tool-call-log';
import { rotatedPath } from '../../../src/diagnostics/rotating-file';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function okResult(payload: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

describe('ToolCallLog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-calls-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records time, tool, duration, outcome, token counts and an args preview', () => {
    const log = new ToolCallLog(dir, { now: () => Date.parse('2026-10-12T08:00:00.000Z') });
    log.record({
      tool: 'find_symbol',
      args: { name: 'greet' },
      durationMs: 12.3456,
      result: okResult({ symbols: [], _meta: { originalTokens: 400, compressedTokens: 100, reduction: '75.0%' } }),
    });
    log.close();

    const { calls } = readToolCalls(dir);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: expect.any(Number),
      time: '2026-10-12T08:00:00.000Z',
      tool: 'find_symbol',
      durationMs: 12.35,
      ok: true,
      errorCode: null,
      originalTokens: 400,
      compressedTokens: 100,
      argsPreview: '{"name":"greet"}',
    });
  });

  it('records the error code of a failed call', () => {
    const log = new ToolCallLog(dir);
    log.record({
      tool: 'get_context',
      args: { filePath: '../../etc/passwd' },
      durationMs: 1,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ error: { code: 'PATH_OUTSIDE_PROJECT', message: 'no' } }) }],
        isError: true,
      },
    });

    const { calls } = readToolCalls(dir);
    expect(calls[0]).toMatchObject({
      tool: 'get_context',
      ok: false,
      errorCode: 'PATH_OUTSIDE_PROJECT',
      originalTokens: null,
      compressedTokens: null,
    });
  });

  it('leaves the token counts empty when the response has no _meta', () => {
    const log = new ToolCallLog(dir);
    log.record({ tool: 'index_status', args: {}, durationMs: 1, result: okResult({ totalFiles: 3 }) });

    const { calls } = readToolCalls(dir);
    expect(calls[0]).toMatchObject({ ok: true, originalTokens: null, compressedTokens: null });
  });

  it('does not store response content', () => {
    const log = new ToolCallLog(dir);
    log.record({
      tool: 'get_context',
      args: { filePath: 'a.ts' },
      durationMs: 1,
      result: okResult({ content: 'SECRET_FILE_BODY', _meta: { originalTokens: 9, compressedTokens: 9 } }),
    });
    log.close();

    expect(readFileSync(join(dir, TOOL_CALL_LOG_FILE), 'utf-8')).not.toContain('SECRET_FILE_BODY');
  });

  it('gives every call a larger id than the one before, even within one millisecond', () => {
    const log = new ToolCallLog(dir, { now: () => 1_800_000_000_000 });
    for (let i = 0; i < 5; i++) log.record({ tool: 't', args: {}, durationMs: 1, result: okResult({}) });

    const ids = readToolCalls(dir).calls.map((c) => c.id);
    expect(ids).toHaveLength(5);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids); // newest first
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((id) => Number.isSafeInteger(id))).toBe(true);
  });

  it('never throws, whatever the result or the directory looks like', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, '');
    const broken = new ToolCallLog(join(blocker, 'data'));
    expect(() => broken.record({ tool: 't', args: {}, durationMs: 1, result: okResult({}) })).not.toThrow();

    const log = new ToolCallLog(dir);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      log.record({ tool: 't', args: circular, durationMs: Number.NaN, result: { content: [{ type: 'text', text: '{not json' }], isError: true } }),
    ).not.toThrow();
    expect(() =>
      log.record({ tool: 't', args: {}, durationMs: 1, result: undefined as unknown as { content: [] } }),
    ).not.toThrow();
    expect(readToolCalls(dir).calls.length).toBeGreaterThanOrEqual(1);
  });

  it('stays within its size bound: one current and one rotated file', () => {
    const log = new ToolCallLog(dir, { maxBytes: 4096 });
    for (let i = 0; i < 400; i++) {
      log.record({ tool: 'find_symbol', args: { name: `symbol-${i}` }, durationMs: 1, result: okResult({}) });
    }
    log.close();

    const path = join(dir, TOOL_CALL_LOG_FILE);
    expect(statSync(path).size).toBeLessThanOrEqual(4096);
    expect(statSync(rotatedPath(path)).size).toBeLessThanOrEqual(4096);
    expect(existsSync(`${path}.2`)).toBe(false);
    const { calls } = readToolCalls(dir, { limit: 1000 });
    expect(calls[0].argsPreview).toBe('{"name":"symbol-399"}');
    expect(calls.length).toBeLessThan(400);
  });
});

describe('buildArgsPreview', () => {
  it('truncates long strings', () => {
    const preview = buildArgsPreview({ query: 'q'.repeat(500), topK: 5 });
    expect(preview).toContain('"topK":5');
    expect(preview).not.toContain('q'.repeat(81));
    expect(preview).toContain('…');
  });

  it('caps the whole preview', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 100; i++) many[`key${i}`] = 'value';
    expect(buildArgsPreview(many).length).toBeLessThanOrEqual(301);
  });

  it('limits arrays and nesting depth', () => {
    const preview = buildArgsPreview({ list: Array.from({ length: 50 }, (_, i) => i), a: { b: { c: { d: 'deep' } } } });
    expect(preview).not.toContain('49');
    expect(preview).not.toContain('deep');
  });

  it('returns a string for input that is not an object', () => {
    expect(typeof buildArgsPreview(undefined)).toBe('string');
    expect(typeof buildArgsPreview('text')).toBe('string');
  });
});

describe('readToolCalls', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-calls-read-'));
    const log = new ToolCallLog(dir);
    for (let i = 0; i < 10; i++) {
      log.record({ tool: i % 2 === 0 ? 'find_symbol' : 'get_context', args: { i }, durationMs: i, result: okResult({}) });
    }
    log.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the newest calls first, limited, with a cursor for the next page', () => {
    const first = readToolCalls(dir, { limit: 4 });
    expect(first.calls.map((c) => c.durationMs)).toEqual([9, 8, 7, 6]);
    expect(first.nextBefore).toBe(first.calls[3].id);

    const second = readToolCalls(dir, { limit: 4, before: first.nextBefore ?? undefined });
    expect(second.calls.map((c) => c.durationMs)).toEqual([5, 4, 3, 2]);

    const third = readToolCalls(dir, { limit: 4, before: second.nextBefore ?? undefined });
    expect(third.calls.map((c) => c.durationMs)).toEqual([1, 0]);
    expect(third.nextBefore).toBeNull();
  });

  it('filters by tool', () => {
    const { calls } = readToolCalls(dir, { tool: 'get_context' });
    expect(calls).toHaveLength(5);
    expect(calls.every((c) => c.tool === 'get_context')).toBe(true);
  });

  it('skips lines that are not complete records', () => {
    const path = join(dir, TOOL_CALL_LOG_FILE);
    writeFileSync(path, `${readFileSync(path, 'utf-8')}{"id":1,"tool":\n[1,2]\n{"id":"x"}\n`);
    expect(readToolCalls(dir).calls).toHaveLength(10);
  });

  it('returns nothing for a data directory without a call log', () => {
    expect(readToolCalls(join(dir, 'missing'))).toEqual({ calls: [], nextBefore: null });
  });

  it('is readable from a second process while the writer is still open', () => {
    const writer = new ToolCallLog(dir);
    writer.record({
      tool: 'impact_analysis',
      args: { symbolId: 'abc' },
      durationMs: 3,
      result: okResult({ _meta: { originalTokens: 50, compressedTokens: 20 } }),
    });

    // A separate Node process reads the same directory through the built module.
    const moduleUrl = pathToFileURL(join(REPO_ROOT, 'dist', 'diagnostics', 'tool-call-log.js')).href;
    const script = `import { readToolCalls } from ${JSON.stringify(moduleUrl)};
      process.stdout.write(JSON.stringify(readToolCalls(process.argv[1], { limit: 1 })));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script, dir], { encoding: 'utf-8' });
    writer.close();

    const { calls } = JSON.parse(out) as { calls: ToolCallRecord[] };
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tool: 'impact_analysis', originalTokens: 50, compressedTokens: 20 });
  });
});

describe('summarizeToolCalls', () => {
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const call = (minutesAgo: number, over: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
    id: now - minutesAgo * 60_000,
    time: new Date(now - minutesAgo * 60_000).toISOString(),
    tool: 'find_symbol',
    durationMs: 10,
    ok: true,
    errorCode: null,
    originalTokens: 100,
    compressedTokens: 40,
    argsPreview: '{}',
    ...over,
  });

  it('summarizes the calls inside the window', () => {
    const calls = [
      call(1, { durationMs: 10 }),
      call(2, { durationMs: 20 }),
      call(3, { durationMs: 30, tool: 'get_context', ok: false, errorCode: 'FILE_NOT_FOUND', originalTokens: null, compressedTokens: null }),
      call(4, { durationMs: 40, tool: 'get_context' }),
      call(120, { durationMs: 9999 }), // outside a 60-minute window
    ];
    const metrics = summarizeToolCalls(calls, { windowMinutes: 60, now });

    expect(metrics.summary).toEqual({
      calls: 4,
      errors: 1,
      p50Ms: 20,
      p95Ms: 40,
      tokensOriginal: 300,
      tokensReturned: 120,
    });
    expect(metrics.byTool).toEqual([
      { tool: 'find_symbol', calls: 2, errors: 0, avgMs: 15, p95Ms: 20, tokensOriginal: 200, tokensReturned: 80 },
      { tool: 'get_context', calls: 2, errors: 1, avgMs: 35, p95Ms: 40, tokensOriginal: 100, tokensReturned: 40 },
    ]);
  });

  it('returns a zero-filled series covering the window, oldest bucket first', () => {
    // 11:58:30 and 11:58:48 fall into the same one-minute bucket.
    const metrics = summarizeToolCalls([call(1.5, { durationMs: 10 }), call(1.2, { durationMs: 30, ok: false })], {
      windowMinutes: 60,
      now,
    });

    expect(metrics.series.length).toBeGreaterThan(1);
    expect(metrics.series.length).toBeLessThanOrEqual(61);
    const times = metrics.series.map((b) => Date.parse(b.t));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(metrics.series.reduce((sum, b) => sum + b.calls, 0)).toBe(2);
    const busy = metrics.series.filter((b) => b.calls > 0);
    expect(busy).toHaveLength(1);
    expect(busy[0]).toMatchObject({ calls: 2, errors: 1, avgMs: 20 });
    expect(metrics.series.filter((b) => b.calls === 0).every((b) => b.avgMs === 0 && b.errors === 0)).toBe(true);
  });

  it('returns zeros when there are no calls', () => {
    const metrics = summarizeToolCalls([], { windowMinutes: 5, now });
    expect(metrics.summary).toEqual({ calls: 0, errors: 0, p50Ms: 0, p95Ms: 0, tokensOriginal: 0, tokensReturned: 0 });
    expect(metrics.byTool).toEqual([]);
    expect(metrics.series.every((b) => b.calls === 0)).toBe(true);
  });
});
