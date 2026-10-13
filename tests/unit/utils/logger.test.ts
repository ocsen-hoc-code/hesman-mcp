import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import {
  LogTee,
  attachLogFile,
  detachLogFile,
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

describe('LogTee (log file next to stderr)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-logger-'));
  });

  afterEach(() => {
    detachLogFile();
    rmSync(dir, { recursive: true, force: true });
  });

  const fileLines = (path: string): Array<{ msg: string; name?: string; level: number }> =>
    readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { msg: string; name?: string; level: number });

  it('writes every line to the primary stream and, once attached, to the file as JSON lines', () => {
    const mem = memoryStream();
    const tee = new LogTee(mem.stream);
    const root = buildRootLogger({ level: 'info', pretty: false }, tee);
    const path = join(dir, 'nested', 'hesman.log');

    tee.attachFile(path);
    root.child({ name: 'unit' }).info({ files: 3 }, 'indexed');

    expect(mem.lines()).toHaveLength(1);
    expect(fileLines(path)).toMatchObject([{ msg: 'indexed', name: 'unit', level: 30, files: 3 }]);
  });

  it('replays the lines logged before the file was attached, up to a bound', () => {
    const mem = memoryStream();
    const tee = new LogTee(mem.stream);
    const root = buildRootLogger({ level: 'info', pretty: false }, tee);
    for (let i = 0; i < 300; i++) root.info(`early-${i}`);
    const path = join(dir, 'hesman.log');

    tee.attachFile(path);
    root.info('late');

    const messages = fileLines(path).map((l) => l.msg);
    expect(messages[messages.length - 1]).toBe('late');
    expect(messages).toContain('early-299');
    expect(messages).not.toContain('early-0');
    expect(messages.length).toBeLessThanOrEqual(201);
    expect(mem.lines()).toHaveLength(301);
  });

  it('stops writing to the file after detach and switches files on a second attach', () => {
    const tee = new LogTee(memoryStream().stream);
    const root = buildRootLogger({ level: 'info', pretty: false }, tee);
    const first = join(dir, 'first.log');
    const second = join(dir, 'second.log');

    tee.attachFile(first);
    root.info('one');
    tee.attachFile(second);
    root.info('two');
    tee.detachFile();
    root.info('three');

    expect(fileLines(first).map((l) => l.msg)).toEqual(['one']);
    expect(fileLines(second).map((l) => l.msg)).toEqual(['two']);
  });

  it('rotates the file at the size cap', () => {
    const tee = new LogTee(memoryStream().stream);
    const root = buildRootLogger({ level: 'info', pretty: false }, tee);
    const path = join(dir, 'hesman.log');
    tee.attachFile(path, { maxBytes: 2000 });
    for (let i = 0; i < 200; i++) root.info(`message number ${i}`);

    expect(statSync(path).size).toBeLessThanOrEqual(2000);
    expect(statSync(`${path}.1`).size).toBeLessThanOrEqual(2000);
    expect(existsSync(`${path}.2`)).toBe(false);
  });

  it('keeps logging to the primary stream when the file cannot be written', () => {
    const mem = memoryStream();
    const tee = new LogTee(mem.stream);
    const root = buildRootLogger({ level: 'info', pretty: false }, tee);
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, '');

    tee.attachFile(join(blocker, 'hesman.log'));
    expect(() => root.info('still here')).not.toThrow();
    expect(mem.lines()).toHaveLength(1);
  });

  it('attachLogFile makes the process-wide named loggers write to the file', () => {
    const path = join(dir, 'process.log');
    attachLogFile(path);
    createLogger('process-wide').warn('to the file');

    expect(fileLines(path).filter((l) => l.name === 'process-wide')).toMatchObject([{ msg: 'to the file', level: 40 }]);
  });
});
