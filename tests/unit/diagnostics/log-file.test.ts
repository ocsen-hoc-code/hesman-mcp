import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readLogEntries, resolveLogFilePath } from '../../../src/diagnostics/log-file';
import { rotatedPath } from '../../../src/diagnostics/rotating-file';

const T0 = Date.parse('2026-10-12T09:00:00.000Z');

function line(offsetMs: number, level: number, msg: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ level, time: T0 + offsetMs, pid: 4242, hostname: 'my-laptop', name: 'hesman', ...extra, msg });
}

describe('resolveLogFilePath', () => {
  const root = resolve('/projects/app');
  const dataDir = join(root, '.hesman');

  it('defaults to <dataDir>/logs/hesman.log', () => {
    expect(resolveLogFilePath(root, dataDir, null)).toBe(join(dataDir, 'logs', 'hesman.log'));
  });

  it('honors a relative logFile, resolved against the project root', () => {
    expect(resolveLogFilePath(root, dataDir, 'var/out.log')).toBe(join(root, 'var', 'out.log'));
  });

  it('honors an absolute logFile', () => {
    const absolute = resolve('/var/log/hesman/out.log');
    expect(resolveLogFilePath(root, dataDir, absolute)).toBe(absolute);
  });
});

describe('readLogEntries', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-logfile-'));
    path = join(dir, 'hesman.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns entries newest first with level names, ISO times and the remaining fields', () => {
    writeFileSync(
      path,
      [
        line(0, 30, 'Opening project', { projectRoot: '/p', source: 'explicit' }),
        line(10, 40, 'Something odd', { name: 'sqlite' }),
      ].join('\n') + '\n',
    );

    const { entries, nextBefore } = readLogEntries(path);
    expect(entries).toEqual([
      { time: '2026-10-12T09:00:00.010Z', level: 'warn', name: 'sqlite', msg: 'Something odd', fields: { pid: 4242 } },
      {
        time: '2026-10-12T09:00:00.000Z',
        level: 'info',
        name: 'hesman',
        msg: 'Opening project',
        fields: { pid: 4242, projectRoot: '/p', source: 'explicit' },
      },
    ]);
    expect(nextBefore).toBeNull();
  });

  it('never returns the host name', () => {
    writeFileSync(path, line(0, 30, 'hello') + '\n');
    expect(JSON.stringify(readLogEntries(path))).not.toContain('my-laptop');
  });

  it('reads the rotated file before the current one', () => {
    writeFileSync(rotatedPath(path), line(0, 30, 'older') + '\n');
    writeFileSync(path, line(5, 30, 'newer') + '\n');

    expect(readLogEntries(path).entries.map((e) => e.msg)).toEqual(['newer', 'older']);
  });

  it('filters by minimum level', () => {
    writeFileSync(
      path,
      [line(0, 20, 'debug'), line(1, 30, 'info'), line(2, 40, 'warn'), line(3, 50, 'error'), line(4, 60, 'fatal')].join('\n'),
    );

    expect(readLogEntries(path, { level: 'warn' }).entries.map((e) => e.msg)).toEqual(['fatal', 'error', 'warn']);
    expect(readLogEntries(path, { level: 'trace' }).entries).toHaveLength(5);
  });

  it('filters by a case-insensitive text match on the message, name and fields', () => {
    writeFileSync(
      path,
      [
        line(0, 30, 'Indexing complete', { files: 7 }),
        line(1, 30, 'Tool handler error', { tool: 'find_symbol' }),
        line(2, 30, 'Other', { name: 'watcher' }),
      ].join('\n'),
    );

    expect(readLogEntries(path, { q: 'INDEXING' }).entries.map((e) => e.msg)).toEqual(['Indexing complete']);
    expect(readLogEntries(path, { q: 'find_symbol' }).entries.map((e) => e.msg)).toEqual(['Tool handler error']);
    expect(readLogEntries(path, { q: 'watcher' }).entries.map((e) => e.msg)).toEqual(['Other']);
  });

  it('pages with an opaque cursor, also across entries of the same millisecond', () => {
    const lines: string[] = [];
    for (let i = 0; i < 7; i++) lines.push(line(i < 4 ? 0 : 1, 30, `m${i}`));
    writeFileSync(path, lines.join('\n') + '\n');

    const first = readLogEntries(path, { limit: 3 });
    expect(first.entries.map((e) => e.msg)).toEqual(['m6', 'm5', 'm4']);
    expect(typeof first.nextBefore).toBe('string');

    const second = readLogEntries(path, { limit: 3, before: first.nextBefore ?? undefined });
    expect(second.entries.map((e) => e.msg)).toEqual(['m3', 'm2', 'm1']);

    const third = readLogEntries(path, { limit: 3, before: second.nextBefore ?? undefined });
    expect(third.entries.map((e) => e.msg)).toEqual(['m0']);
    expect(third.nextBefore).toBeNull();
  });

  it('keeps a cursor valid when new lines are appended', () => {
    writeFileSync(path, [line(0, 30, 'a'), line(1, 30, 'b'), line(2, 30, 'c')].join('\n') + '\n');
    const first = readLogEntries(path, { limit: 2 });
    writeFileSync(path, [line(0, 30, 'a'), line(1, 30, 'b'), line(2, 30, 'c'), line(3, 30, 'd')].join('\n') + '\n');

    expect(readLogEntries(path, { limit: 2, before: first.nextBefore ?? undefined }).entries.map((e) => e.msg)).toEqual(['a']);
  });

  it('skips lines that are not log records and rejects an unreadable cursor', () => {
    writeFileSync(path, ['not json', '[1]', '{"level":30}', line(0, 30, 'good')].join('\n'));

    expect(readLogEntries(path).entries.map((e) => e.msg)).toEqual(['good']);
    expect(() => readLogEntries(path, { before: 'garbage' })).toThrow(/cursor/i);
  });

  it('returns nothing when there is no log file', () => {
    expect(readLogEntries(join(dir, 'missing.log'))).toEqual({ entries: [], nextBefore: null });
  });
});
