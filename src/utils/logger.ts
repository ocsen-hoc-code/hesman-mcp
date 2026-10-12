import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import { RotatingFile } from '../diagnostics/rotating-file.js';
import { LOG_FILE_MAX_BYTES } from '../diagnostics/log-file.js';

/**
 * Logging for Hesman.
 *
 * In MCP stdio mode stdout is the JSON-RPC channel, so every log line goes to
 * **stderr** (fd 2). All named loggers are children of one shared root logger,
 * so at most one pino-pretty transport thread exists for the whole process.
 *
 * The server additionally keeps the same JSON lines in a size-capped file
 * (`attachLogFile`), so they can be read after the client that owns stderr is
 * gone — by a person or by `hesman ui`. Never log file contents or secrets:
 * log lines outlive the process.
 */

export interface LoggerOptions {
  level: string;
  /** Human-readable output via pino-pretty (only useful on an interactive terminal). */
  pretty: boolean;
}

const STDERR_FD = 2;

/** Lines kept in memory until the log file is known (the project root may come from the client). */
const MAX_PENDING_LINES = 200;

export interface LogFileOptions {
  /** Rotation size. Default `LOG_FILE_MAX_BYTES`. */
  maxBytes?: number;
}

/**
 * A log destination that forwards every line to `primary` (stderr) and, once
 * a file is attached, appends it to that file as well. Lines written before
 * the first attach are kept (the newest `MAX_PENDING_LINES`) and replayed, so
 * the file starts with the server's first lines. A file that cannot be written
 * never affects `primary`.
 */
export class LogTee implements DestinationStream {
  private file: RotatingFile | undefined;
  /** `undefined` once a file has been attached: nothing is buffered afterwards. */
  private pending: string[] | undefined = [];
  private readonly primary: DestinationStream;

  constructor(primary: DestinationStream) {
    this.primary = primary;
  }

  write(chunk: string): void {
    this.primary.write(chunk);
    const line = chunk.endsWith('\n') ? chunk.slice(0, -1) : chunk;
    if (this.file) {
      this.file.append(line);
    } else if (this.pending) {
      this.pending.push(line);
      if (this.pending.length > MAX_PENDING_LINES) this.pending.shift();
    }
  }

  /** Starts (or moves) the file copy. Never throws. */
  attachFile(path: string, options: LogFileOptions = {}): void {
    this.file?.close();
    this.file = new RotatingFile(path, { maxBytes: options.maxBytes ?? LOG_FILE_MAX_BYTES });
    const replay = this.pending ?? [];
    this.pending = undefined;
    for (const line of replay) this.file.append(line);
  }

  /** Stops the file copy; stderr logging continues. */
  detachFile(): void {
    this.file?.close();
    this.file = undefined;
    this.pending = undefined;
  }
}

/** Derives logger options from the environment and whether stderr is a TTY. */
export function resolveLoggerOptions(input: {
  isTTY: boolean | undefined;
  env: NodeJS.ProcessEnv;
}): LoggerOptions {
  return {
    level: input.env.HESMAN_LOG_LEVEL || 'info',
    pretty: input.isTTY === true,
  };
}

/**
 * Builds a root logger. Writes to stderr unless an explicit `destination` is
 * given (used by tests). Pretty output always goes to stderr.
 */
export function buildRootLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  if (options.pretty && !destination) {
    return pino({
      level: options.level,
      transport: { target: 'pino-pretty', options: { colorize: true, destination: STDERR_FD } },
    });
  }
  return pino({ level: options.level }, destination ?? pino.destination(STDERR_FD));
}

let root: Logger | undefined;
let rootTee: LogTee | undefined;

/** The destination of the process-wide root logger: stderr (pretty on a terminal) plus the optional file. */
function getRootTee(options: LoggerOptions): LogTee {
  if (!rootTee) {
    const stderr: DestinationStream = options.pretty
      ? (pino.transport({ target: 'pino-pretty', options: { colorize: true, destination: STDERR_FD } }) as DestinationStream)
      : pino.destination(STDERR_FD);
    rootTee = new LogTee(stderr);
  }
  return rootTee;
}

/** The process-wide root logger, created on first use. */
export function getRootLogger(): Logger {
  if (!root) {
    const options = resolveLoggerOptions({ isTTY: process.stderr.isTTY, env: process.env });
    root = buildRootLogger(options, getRootTee(options));
  }
  return root;
}

/**
 * Also append every log line of this process to `path` (JSON lines, capped,
 * one rotated file `<path>.1`). A second call moves the copy to the new path.
 * Never throws: a log file that cannot be written is silently skipped.
 */
export function attachLogFile(path: string, options?: LogFileOptions): void {
  getRootLogger();
  rootTee?.attachFile(path, options);
}

/** Stop appending log lines to the file given to `attachLogFile`. */
export function detachLogFile(): void {
  rootTee?.detachFile();
}

/**
 * Returns a named child of the shared root logger. The level is read from
 * `HESMAN_LOG_LEVEL` at call time (default `info`).
 */
export function createLogger(name: string): Logger {
  const level = process.env.HESMAN_LOG_LEVEL || 'info';
  return getRootLogger().child({ name }, { level });
}
