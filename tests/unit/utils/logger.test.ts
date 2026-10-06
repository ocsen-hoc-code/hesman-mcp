import { describe, it, expect, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import {
  buildRootLogger,
  createLogger,
  getRootLogger,
  resolveLoggerOptions,
} from '../../../src/utils/logger';

/** In-memory destination that collects written log lines. */
function memoryStream(): { stream: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l.length > 0),
  };
}

describe('createLogger', () => {
  afterEach(() => {
    delete process.env.HESMAN_LOG_LEVEL;
  });

  it('returns a logger with the given name', () => {
    const log = createLogger('test');
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(log.bindings().name).toBe('test');
  });

  it('respects HESMAN_LOG_LEVEL env var', () => {
    process.env.HESMAN_LOG_LEVEL = 'debug';
    const log = createLogger('test-debug');
    expect(log.level).toBe('debug');
  });

  it('defaults to info level', () => {
    const log = createLogger('test-default');
    expect(log.level).toBe('info');
  });

  it('returns children of one shared root logger', () => {
    const root = getRootLogger();
    expect(getRootLogger()).toBe(root);
    const a = createLogger('a');
    const b = createLogger('b');
    expect(a).not.toBe(root);
    // Children share the parent's stream, so no extra transport is created.
    const streamSym = Object.getOwnPropertySymbols(root).find((s) => s.toString() === 'Symbol(pino.stream)');
    expect(streamSym).toBeDefined();
    const rec = (l: object): unknown => (l as Record<symbol, unknown>)[streamSym as symbol];
    expect(rec(a)).toBe(rec(root));
    expect(rec(b)).toBe(rec(root));
  });
});

describe('resolveLoggerOptions', () => {
  it('uses pino-pretty only when stderr is a TTY', () => {
    expect(resolveLoggerOptions({ isTTY: true, env: {} }).pretty).toBe(true);
    expect(resolveLoggerOptions({ isTTY: false, env: {} }).pretty).toBe(false);
  });

  it('ignores NODE_ENV for pretty selection', () => {
    expect(resolveLoggerOptions({ isTTY: false, env: { NODE_ENV: 'development' } }).pretty).toBe(false);
  });

  it('reads the level from HESMAN_LOG_LEVEL, defaulting to info', () => {
    expect(resolveLoggerOptions({ isTTY: false, env: {} }).level).toBe('info');
    expect(resolveLoggerOptions({ isTTY: false, env: { HESMAN_LOG_LEVEL: 'warn' } }).level).toBe('warn');
  });
});

describe('buildRootLogger', () => {
  it('writes JSON lines to the given destination', () => {
    const mem = memoryStream();
    const root = buildRootLogger({ level: 'info', pretty: false }, mem.stream);
    root.child({ name: 'unit' }).info('hello');
    const lines = mem.lines();
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { name: string; msg: string };
    expect(entry.name).toBe('unit');
    expect(entry.msg).toBe('hello');
  });

  it('filters below the configured level', () => {
    const mem = memoryStream();
    const root = buildRootLogger({ level: 'warn', pretty: false }, mem.stream);
    root.info('dropped');
    root.warn('kept');
    expect(mem.lines()).toHaveLength(1);
  });
});
