import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatCount,
  formatDuration,
  formatPercent,
  formatRelative,
  formatTokens,
  parseTime,
  shortPath,
  tokenSavings,
} from '../../../src/ui/public/js/lib/format.js';

describe('formatDuration', () => {
  it('shows a dash for missing or invalid values', () => {
    expect(formatDuration(null)).toBe('–');
    expect(formatDuration(undefined)).toBe('–');
    expect(formatDuration(Number.NaN)).toBe('–');
    expect(formatDuration(-5)).toBe('–');
  });

  it('keeps one decimal below 10 ms', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(0.04)).toBe('<0.1 ms');
    expect(formatDuration(4.26)).toBe('4.3 ms');
    expect(formatDuration(3)).toBe('3 ms');
  });

  it('rounds to whole milliseconds below one second', () => {
    expect(formatDuration(12.4)).toBe('12 ms');
    expect(formatDuration(999.4)).toBe('999 ms');
  });

  it('never prints 1000 ms', () => {
    expect(formatDuration(999.6)).toBe('1.00 s');
  });

  it('switches to seconds and minutes', () => {
    expect(formatDuration(1240)).toBe('1.24 s');
    expect(formatDuration(12_340)).toBe('12.3 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatDuration(120_000)).toBe('2 min');
  });
});

describe('formatCount and formatTokens', () => {
  it('groups thousands', () => {
    expect(formatCount(1764)).toBe('1,764');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('–');
  });

  it('abbreviates large token counts only', () => {
    expect(formatTokens(178)).toBe('178');
    expect(formatTokens(9999)).toBe('9,999');
    expect(formatTokens(17_640)).toBe('17.6k');
    expect(formatTokens(1_250_000)).toBe('1.25M');
    expect(formatTokens(undefined)).toBe('–');
  });
});

describe('tokenSavings', () => {
  it('computes the saved share', () => {
    expect(tokenSavings(1764, 178)).toEqual({ saved: 1586, ratio: 1586 / 1764, label: '89.9%' });
  });

  it('is never negative', () => {
    expect(tokenSavings(100, 140)).toEqual({ saved: 0, ratio: 0, label: '0.0%' });
  });

  it('has no percentage without a baseline', () => {
    expect(tokenSavings(0, 0).label).toBe('–');
    expect(tokenSavings(null, 5).label).toBe('–');
  });
});

describe('formatPercent', () => {
  it('formats a ratio with one decimal', () => {
    expect(formatPercent(0.125)).toBe('12.5%');
    expect(formatPercent(Number.NaN)).toBe('–');
  });
});

describe('time helpers', () => {
  it('parses ISO strings and epoch milliseconds', () => {
    expect(parseTime('2026-10-12T08:00:00.000Z')).toBe(Date.UTC(2026, 9, 12, 8));
    expect(parseTime(1_791_792_000_000)).toBe(1_791_792_000_000);
    expect(parseTime('not a date')).toBeNull();
    expect(parseTime(null)).toBeNull();
  });

  it('formats a clock time in the requested zone', () => {
    expect(formatClock('2026-10-12T08:05:09.000Z', { timeZone: 'UTC' })).toBe('08:05:09');
    expect(formatClock('garbage', { timeZone: 'UTC' })).toBe('–');
  });

  it('describes how long ago something happened', () => {
    const now = Date.UTC(2026, 9, 12, 12);
    expect(formatRelative(now - 2_000, now)).toBe('just now');
    expect(formatRelative(now - 42_000, now)).toBe('42 s ago');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe('2 d ago');
    expect(formatRelative(null, now)).toBe('never');
  });
});

describe('shortPath', () => {
  it('keeps short paths', () => {
    expect(shortPath('src/index.ts', 30)).toBe('src/index.ts');
  });

  it('keeps the file name and the first folder of a long path', () => {
    expect(shortPath('src/indexing/deep/nested/index-coordinator.ts', 30)).toBe('src/…/index-coordinator.ts');
  });

  it('truncates a file name that is too long on its own', () => {
    const out = shortPath('a-very-long-file-name-that-never-ends.ts', 12);
    expect(out.length).toBe(12);
    expect(out.startsWith('…')).toBe(true);
  });
});
