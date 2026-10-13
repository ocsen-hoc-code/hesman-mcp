import { join, resolve } from 'node:path';
import { readRotatedLines } from './rotating-file.js';

/**
 * The server's log file: where it is, and how another process reads it.
 *
 * The MCP server writes the same JSON lines it sends to stderr into this file
 * (`attachLogFile` in `utils/logger.ts`); `hesman ui` reads them back here.
 * The file is capped at `LOG_FILE_MAX_BYTES` with one rotated file next to it.
 */

export const LOG_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Path of the log file of a project: the `logFile` setting when set (relative
 * paths resolve against the project root), else `<dataDir>/logs/hesman.log`.
 */
export function resolveLogFilePath(projectRoot: string, dataDir: string, logFile: string | null): string {
  if (logFile !== null && logFile.length > 0) return resolve(projectRoot, logFile);
  return join(dataDir, 'logs', 'hesman.log');
}

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** pino's numeric levels. */
const LEVEL_VALUES: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

function levelName(value: number): LogLevel {
  let name: LogLevel = 'trace';
  for (const level of LOG_LEVELS) {
    if (value >= LEVEL_VALUES[level]) name = level;
  }
  return name;
}

export interface LogEntry {
  /** ISO 8601. */
  time: string;
  level: LogLevel;
  /** Name of the logger (`createLogger(name)`), `null` for the root logger. */
  name: string | null;
  msg: string;
  /** Every other field of the line, except the host name. */
  fields: Record<string, unknown>;
}

export interface LogQuery {
  /** Minimum level. Default: every level in the file. */
  level?: LogLevel;
  /** Case-insensitive text that must occur in the message, the name or the fields. */
  q?: string;
  /** Page size. Default 200. */
  limit?: number;
  /** The `nextBefore` of the previous page. */
  before?: string;
}

export interface LogPage {
  /** Newest first. */
  entries: LogEntry[];
  /** Pass as `before` for the next (older) page; `null` when there is none. */
  nextBefore: string | null;
}

/** Thrown for a `before` value that `readLogEntries` did not hand out. */
export class InvalidLogCursorError extends Error {
  constructor() {
    super('Invalid log cursor');
    this.name = 'InvalidLogCursorError';
  }
}

/** Position of a line: its time and its rank among the lines of the same millisecond (oldest = 0). */
interface Position {
  time: number;
  rank: number;
}

// A cursor names a line by time and rank, not by offset, so it stays valid
// when lines are appended and when the older file is rotated away.
function encodeCursor(position: Position): string {
  return `${position.time}-${position.rank}`;
}

function decodeCursor(cursor: string): Position {
  const match = /^(\d{1,16})-(\d{1,9})$/.exec(cursor);
  if (!match) throw new InvalidLogCursorError();
  return { time: Number(match[1]), rank: Number(match[2]) };
}

function isBefore(a: Position, b: Position): boolean {
  return a.time < b.time || (a.time === b.time && a.rank < b.rank);
}

interface ParsedLine {
  position: Position;
  levelValue: number;
  entry: LogEntry;
}

function parseLine(line: string): Omit<ParsedLine, 'position'> & { time: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null; // e.g. a line that is still being written
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { level, time, name, msg, hostname: _hostname, ...fields } = raw as Record<string, unknown>;
  if (typeof level !== 'number' || typeof time !== 'number' || !Number.isFinite(time)) return null;
  return {
    time,
    levelValue: level,
    entry: {
      time: new Date(time).toISOString(),
      level: levelName(level),
      name: typeof name === 'string' ? name : null,
      msg: typeof msg === 'string' ? msg : '',
      fields,
    },
  };
}

/** One page of the log at `path` (and its rotated file), newest first. */
export function readLogEntries(path: string, query: LogQuery = {}): LogPage {
  const before = query.before !== undefined ? decodeCursor(query.before) : undefined;
  const limit = query.limit ?? 200;
  const minLevel = query.level ? LEVEL_VALUES[query.level] : 0;
  const needle = query.q ? query.q.toLowerCase() : '';

  // Rank the lines first, over everything: a rank must not depend on the filters.
  const parsed: ParsedLine[] = [];
  let lastTime = Number.NaN;
  let rank = 0;
  for (const line of readRotatedLines(path)) {
    const item = parseLine(line);
    if (!item) continue;
    rank = item.time === lastTime ? rank + 1 : 0;
    lastTime = item.time;
    parsed.push({ position: { time: item.time, rank }, levelValue: item.levelValue, entry: item.entry });
  }

  const matches: ParsedLine[] = [];
  for (let i = parsed.length - 1; i >= 0 && matches.length <= limit; i--) {
    const item = parsed[i];
    if (before && !isBefore(item.position, before)) continue;
    if (item.levelValue < minLevel) continue;
    if (needle) {
      const { entry } = item;
      const haystack = `${entry.msg}\n${entry.name ?? ''}\n${JSON.stringify(entry.fields)}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    matches.push(item);
  }

  const page = matches.slice(0, limit);
  return {
    entries: page.map((m) => m.entry),
    nextBefore: matches.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1].position) : null,
  };
}
