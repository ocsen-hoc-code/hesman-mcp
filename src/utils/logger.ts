import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';

/**
 * Logging for Hesman.
 *
 * In MCP stdio mode stdout is the JSON-RPC channel, so every log line goes to
 * **stderr** (fd 2). All named loggers are children of one shared root logger,
 * so at most one pino-pretty transport thread exists for the whole process.
 */

export interface LoggerOptions {
  level: string;
  /** Human-readable output via pino-pretty (only useful on an interactive terminal). */
  pretty: boolean;
}

const STDERR_FD = 2;

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

/** The process-wide root logger, created on first use. */
export function getRootLogger(): Logger {
  if (!root) {
    root = buildRootLogger(resolveLoggerOptions({ isTTY: process.stderr.isTTY, env: process.env }));
  }
  return root;
}

/**
 * Returns a named child of the shared root logger. The level is read from
 * `HESMAN_LOG_LEVEL` at call time (default `info`).
 */
export function createLogger(name: string): Logger {
  const level = process.env.HESMAN_LOG_LEVEL || 'info';
  return getRootLogger().child({ name }, { level });
}
