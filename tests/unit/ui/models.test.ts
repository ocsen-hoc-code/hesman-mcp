import { describe, expect, it } from 'vitest';
import { fieldRows, logKey, mergeLogEntries } from '../../../src/ui/public/js/lib/logs-model.js';
import { loadHistory, pushHistory } from '../../../src/ui/public/js/lib/history.js';
import { buildRoute, parseRoute } from '../../../src/ui/public/js/lib/router.js';
import { summarizeToolRun } from '../../../src/ui/public/js/lib/tool-result.js';
import { niceMax, scaleSeries, ticks } from '../../../src/ui/public/js/lib/chart-scale.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('mergeLogEntries', () => {
  const e = (time: string, msg: string) => ({ time, level: 'info', name: 'hesman', msg, fields: {} });

  it('puts new entries first and drops duplicates', () => {
    const existing = [e('2026-10-12T08:00:02Z', 'b'), e('2026-10-12T08:00:01Z', 'a')];
    const incoming = [e('2026-10-12T08:00:03Z', 'c'), e('2026-10-12T08:00:02Z', 'b')];
    expect(mergeLogEntries(existing, incoming).map((x: { msg: string }) => x.msg)).toEqual(['c', 'b', 'a']);
  });

  it('keeps two different entries that share a timestamp', () => {
    const out = mergeLogEntries([e('2026-10-12T08:00:01Z', 'a')], [e('2026-10-12T08:00:01Z', 'other')]);
    expect(out).toHaveLength(2);
  });

  it('sorts newest first whatever the input order', () => {
    const out = mergeLogEntries([], [e('2026-10-12T08:00:01Z', 'a'), e('2026-10-12T08:00:05Z', 'z')]);
    expect(out.map((x: { msg: string }) => x.msg)).toEqual(['z', 'a']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => e(new Date(1_791_792_000_000 + i * 1000).toISOString(), `m${i}`));
    const out = mergeLogEntries([], many, 10);
    expect(out).toHaveLength(10);
    expect(out[0].msg).toBe('m29');
  });
});

describe('logKey', () => {
  it('is equal for the same entry and different when any visible part differs', () => {
    const entry = { time: '2026-10-12T08:00:01Z', level: 'info', name: 'hesman', msg: 'a', fields: {} };
    expect(logKey({ ...entry })).toBe(logKey(entry));
    expect(logKey({ ...entry, msg: 'b' })).not.toBe(logKey(entry));
    expect(logKey({ ...entry, level: 'warn' })).not.toBe(logKey(entry));
    expect(logKey({ ...entry, fields: { callId: 'c2' } })).not.toBe(logKey({ ...entry, fields: { callId: 'c1' } }));
  });
});

describe('fieldRows', () => {
  it('lists structured fields as key and printable value', () => {
    expect(fieldRows({ tool: 'find_symbol', ms: 4, nested: { a: 1 }, none: null })).toEqual([
      ['tool', 'find_symbol'],
      ['ms', '4'],
      ['nested', '{"a":1}'],
      ['none', 'null'],
    ]);
  });

  it('is empty for missing fields', () => {
    expect(fieldRows(undefined)).toEqual([]);
    expect(fieldRows({})).toEqual([]);
    expect(fieldRows('x')).toEqual([]);
  });
});

describe('playground history', () => {
  it('adds the newest run first and caps the list', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 25; i++) pushHistory(storage, { tool: 't', args: { i }, time: i, durationMs: 1, isError: false });
    const list = loadHistory(storage);
    expect(list).toHaveLength(20);
    expect(list[0].args).toEqual({ i: 24 });
  });

  it('collapses an identical consecutive run', () => {
    const storage = memoryStorage();
    pushHistory(storage, { tool: 't', args: { a: 1 }, time: 1, durationMs: 1, isError: false });
    pushHistory(storage, { tool: 't', args: { a: 1 }, time: 2, durationMs: 5, isError: true });
    const list = loadHistory(storage);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ time: 2, isError: true });
  });

  it('survives corrupt or unavailable storage', () => {
    expect(loadHistory(memoryStorage({ 'hesman.playground.history': '{broken' }))).toEqual([]);
    expect(loadHistory(memoryStorage({ 'hesman.playground.history': '{"a":1}' }))).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadHistory(throwing)).toEqual([]);
    expect(pushHistory(throwing, { tool: 't', args: {}, time: 1, durationMs: 1, isError: false })).toHaveLength(1);
    expect(loadHistory(null)).toEqual([]);
  });
});

describe('router', () => {
  it('parses a view and its parameters', () => {
    expect(parseRoute('#/graph?symbol=abc%20d&mode=files')).toEqual({
      view: 'graph',
      params: { symbol: 'abc d', mode: 'files' },
    });
  });

  it('falls back to the overview', () => {
    expect(parseRoute('')).toEqual({ view: 'overview', params: {} });
    expect(parseRoute('#/nonsense')).toEqual({ view: 'overview', params: {} });
  });

  it('round-trips playground arguments', () => {
    const hash = buildRoute('playground', { tool: 'get_callers', args: JSON.stringify({ symbolId: 'a&b=c', maxDepth: 2 }) });
    const parsed = parseRoute(hash);
    expect(parsed.view).toBe('playground');
    expect(JSON.parse(parsed.params.args)).toEqual({ symbolId: 'a&b=c', maxDepth: 2 });
  });

  it('builds a bare route without parameters', () => {
    expect(buildRoute('logs')).toBe('#/logs');
    expect(buildRoute('logs', { q: '' })).toBe('#/logs');
  });
});

describe('summarizeToolRun', () => {
  it('extracts the token numbers from _meta', () => {
    const s = summarizeToolRun({
      result: {
        symbols: [],
        _meta: { originalTokens: 1764, compressedTokens: 178, reduction: '89.9%', compressed: false, layers: ['prune'] },
      },
      isError: false,
      durationMs: 4.2,
    });
    expect(s).toMatchObject({
      isError: false,
      durationMs: 4.2,
      meta: { originalTokens: 1764, compressedTokens: 178, reduction: '89.9%', layers: ['prune'], compressed: false },
      indexing: null,
      error: null,
    });
    expect(s.json).toContain('"symbols": []');
  });

  it('reports a partial index', () => {
    const s = summarizeToolRun({
      result: { _meta: { originalTokens: 1, compressedTokens: 1, indexing: { inProgress: true, filesDone: 3, filesTotal: 9 } } },
      isError: false,
      durationMs: 1,
    });
    expect(s.indexing).toEqual({ inProgress: true, filesDone: 3, filesTotal: 9 });
  });

  it('extracts the tool error', () => {
    const s = summarizeToolRun({
      result: { error: { code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found: x' } },
      isError: true,
      durationMs: 0.3,
    });
    expect(s.isError).toBe(true);
    expect(s.error).toEqual({ code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found: x' });
    expect(s.meta).toBeNull();
  });

  it('parses a result delivered as a JSON string and tolerates plain text', () => {
    expect(summarizeToolRun({ result: '{"a":1}', isError: false, durationMs: 1 }).json).toBe('{\n  "a": 1\n}');
    expect(summarizeToolRun({ result: 'plain', isError: false, durationMs: 1 }).json).toBe('plain');
    expect(summarizeToolRun(undefined)).toMatchObject({ isError: false, meta: null, json: '' });
  });
});

describe('chart scale', () => {
  it('rounds the axis maximum up to a clean number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(43)).toBe(50);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(0.3)).toBe(0.5);
  });

  it('produces evenly spaced ticks from zero', () => {
    expect(ticks(20, 4)).toEqual([0, 5, 10, 15, 20]);
    expect(ticks(1, 2)).toEqual([0, 0.5, 1]);
  });

  it('maps a series to pixel coordinates with zero at the bottom', () => {
    const out = scaleSeries([0, 5, 10], { width: 100, height: 50, max: 10 });
    expect(out).toEqual([
      { x: 0, y: 50, value: 0 },
      { x: 50, y: 25, value: 5 },
      { x: 100, y: 0, value: 10 },
    ]);
    expect(scaleSeries([4], { width: 100, height: 50, max: 8 })).toEqual([{ x: 50, y: 25, value: 4 }]);
  });
});
