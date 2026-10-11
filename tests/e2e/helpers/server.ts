/**
 * Real-server e2e harness.
 *
 * Spawns the shipped binary (`node dist/index.js`) against a fixture project,
 * records every raw stdout/stderr line, and exposes a normal MCP `Client`.
 *
 * Non-protocol stdout lines (e.g. log output) are recorded but never handed
 * to the MCP client, so tests can assert on stdout pollution without the
 * client choking on it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  JSONRPCMessageSchema,
  ListRootsRequestSchema,
  type CallToolResult,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (contains `dist/`, `src/`, `tests/`). */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** Built server entry point exercised by the harness. */
export const DIST_ENTRY = join(REPO_ROOT, 'dist', 'index.js');

/** Directory holding fixture projects. */
export const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures');

/** Absolute path of a fixture project by name (e.g. `polyglot-basic`). */
export function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

// ── Transport ────────────────────────────────────────────────────────────

/**
 * Splits a byte stream into lines, keeping a trailing partial line buffered.
 * Handles both `\n` and `\r\n` endings.
 */
class LineSplitter {
  private buffer = '';

  push(chunk: Buffer | string): string[] {
    this.buffer += chunk.toString();
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop() ?? '';
    return parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    return rest.length > 0 ? [rest] : [];
  }
}

/** Parses a stdout line as a JSON-RPC message, or returns `null` if it is not one. */
export function parseJsonRpcLine(line: string): JSONRPCMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const parsed = JSONRPCMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface RecordingTransportOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Grace period for the child to exit after SIGTERM before SIGKILL. Default 10s. */
  killTimeoutMs?: number;
}

/**
 * MCP client transport over a child process' stdio that records every raw
 * stdout and stderr line before any parsing. Lines that are not valid
 * JSON-RPC messages are recorded and otherwise ignored.
 */
export class RecordingStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  /** Every raw stdout line, in arrival order. */
  readonly stdoutLines: string[] = [];
  /** Every raw stdout line that was not a valid JSON-RPC message. */
  readonly nonProtocolStdoutLines: string[] = [];
  /** Every raw stderr line, in arrival order. */
  readonly stderrLines: string[] = [];

  private child?: ChildProcess;
  private exitPromise?: Promise<void>;
  private closed = false;
  private readonly options: RecordingTransportOptions;

  constructor(options: RecordingTransportOptions) {
    this.options = options;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Exit code of the child, `null` while running or if killed by a signal. */
  get exitCode(): number | null {
    return this.child?.exitCode ?? null;
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('RecordingStdioTransport already started');

    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    const stdout = new LineSplitter();
    const stderr = new LineSplitter();
    const handleStdout = (lines: string[]): void => {
      for (const line of lines) {
        this.stdoutLines.push(line);
        const message = parseJsonRpcLine(line);
        if (message) {
          this.onmessage?.(message);
        } else if (line.trim().length > 0) {
          this.nonProtocolStdoutLines.push(line);
        }
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => handleStdout(stdout.push(chunk)));
    child.stderr?.on('data', (chunk: Buffer) => this.stderrLines.push(...stderr.push(chunk)));
    child.stdin?.on('error', (err) => this.onerror?.(err));

    this.exitPromise = new Promise<void>((resolveExit) => {
      child.on('close', () => {
        handleStdout(stdout.flush());
        this.stderrLines.push(...stderr.flush());
        this.markClosed();
        resolveExit();
      });
    });

    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once('spawn', () => resolveSpawn());
      child.once('error', (err) => {
        this.onerror?.(err);
        rejectSpawn(err);
      });
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || this.closed) throw new Error('Transport is not connected');
    const payload = JSON.stringify(message) + '\n';
    await new Promise<void>((resolveWrite, rejectWrite) => {
      stdin.write(payload, (err) => (err ? rejectWrite(err) : resolveWrite()));
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child || !this.exitPromise) {
      this.markClosed();
      return;
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin?.end();
      child.kill('SIGTERM');
      const killTimeoutMs = this.options.killTimeoutMs ?? 10_000;
      const timer = setTimeout(() => child.kill('SIGKILL'), killTimeoutMs);
      try {
        await this.exitPromise;
      } finally {
        clearTimeout(timer);
      }
    } else {
      await this.exitPromise;
    }
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

// ── Server harness ───────────────────────────────────────────────────────

export interface StartServerOptions {
  /** Fixture name under `tests/fixtures/`, or an absolute project path. Default `polyglot-basic`. */
  fixture?: string;
  /** Enable semantic search (downloads/loads the embedding model). Default `false` (`--no-semantic`). */
  semantic?: boolean;
  /** Enable the file watcher. Default `false` (`--no-watch`). */
  watch?: boolean;
  /** `HESMAN_LOG_LEVEL` for the child. Default `info`, so log output is visible to tests. */
  logLevel?: string;
  /** Extra CLI args appended after the default flags. */
  extraArgs?: string[];
  /** Extra environment variables (override the defaults). */
  env?: Record<string, string>;
  /** Wait until the initial background index has finished (`index_status.indexing.inProgress === false`). Default `true`. */
  waitForIndex?: boolean;
  /** Max time for connect + readiness, in ms. Default 60s. */
  readyTimeoutMs?: number;
  /**
   * Pass the project to the server explicitly through `HESMAN_PROJECT_ROOT`. Default `true`.
   * With `false` the variable is removed, so the server has to find the project itself
   * (MCP roots, then its working directory).
   */
  explicitRoot?: boolean;
  /** Working directory of the server process. Default: the project path. */
  cwd?: string;
  /**
   * Makes the test client advertise the MCP `roots` capability and answer `roots/list` with
   * these folders (paths or URIs). `'unanswered'` advertises the capability but never answers.
   * Default: no roots capability.
   */
  roots?: readonly string[] | 'unanswered';
  /**
   * Point `HESMAN_DATA_DIR` at a temp dir removed by `stop()`. Default `true`. With `false`
   * the server uses its default, `.hesman` inside the project it resolved.
   */
  tempDataDir?: boolean;
}

export interface IndexStatus {
  totalFiles: number;
  indexedFiles: number;
  totalSymbols: number;
  totalRelations: number;
  /** State of the initial background index. */
  indexing?: {
    inProgress: boolean;
    phase: string;
    filesDone: number;
    filesTotal: number;
    startedAt: string | null;
    error: string | null;
  };
  [key: string]: unknown;
}

export interface HesmanTestServer {
  client: Client;
  transport: RecordingStdioTransport;
  /** Absolute path of the indexed project. */
  projectRoot: string;
  /** Absolute path of the temporary data dir (removed by `stop()`); unused with `tempDataDir: false`. */
  dataDir: string;
  /** Every raw stdout line (live array). */
  readonly stdoutLines: readonly string[];
  /** Raw stdout lines that are not JSON-RPC messages (live array). */
  readonly nonProtocolStdoutLines: readonly string[];
  /** Every raw stderr line (live array). */
  readonly stderrLines: readonly string[];
  /** Calls a tool and returns the raw result. */
  callTool(name: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<CallToolResult>;
  /** Calls a tool and parses its concatenated text content as JSON. */
  callToolJson<T = unknown>(name: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  /** Polls `index_status` until the initial background index has finished or the timeout elapses. */
  waitForIndex(timeoutMs?: number): Promise<IndexStatus>;
  /** Replaces the roots the client reports and sends `notifications/roots/list_changed`. Needs the `roots` option. */
  setRoots(roots: readonly string[]): Promise<void>;
  /** Closes the client, stops the child process and removes the data dir. Idempotent. */
  stop(): Promise<void>;
}

/** Concatenates the text parts of a tool result. */
export function toolText(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function describeOutput(transport: RecordingStdioTransport): string {
  const tail = (lines: readonly string[]): string => lines.slice(-20).join('\n');
  return `\n--- stdout (last 20 lines) ---\n${tail(transport.stdoutLines)}` +
    `\n--- stderr (last 20 lines) ---\n${tail(transport.stderrLines)}`;
}

/**
 * Polls `index_status` until the initial background index has finished
 * (`indexing.inProgress === false`). The server answers MCP requests while it
 * is still indexing, so a non-empty index is not a sign of readiness: tests
 * would otherwise query a partial index. Throws on timeout, or as soon as the
 * index run reports a failure.
 */
export async function waitForIndexReady(
  client: Client,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<IndexStatus> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let last: IndexStatus | undefined;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    try {
      const result = (await client.callTool(
        { name: 'index_status', arguments: {} },
        undefined,
        { timeout: remaining },
      )) as CallToolResult;
      last = JSON.parse(toolText(result)) as IndexStatus;
      if (last.indexing?.error) break;
      if (last.indexing?.inProgress === false) return last;
    } catch (err) {
      lastError = err;
    }
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }

  const detail = last ? `last status: ${JSON.stringify(last)}` : `last error: ${String(lastError)}`;
  if (last?.indexing?.error) throw new Error(`Initial index failed: ${last.indexing.error} (${detail})`);
  throw new Error(`Server not ready after ${timeoutMs}ms (${detail})`);
}

/** MCP root entry for a folder given as a path or as a URI. */
function toRootEntry(pathOrUri: string): { uri: string; name: string } {
  const uri = /^[a-z][a-z0-9+.-]+:\/\//i.test(pathOrUri) ? pathOrUri : pathToFileURL(pathOrUri).href;
  return { uri, name: pathOrUri.split(/[\\/]/).filter(Boolean).pop() ?? pathOrUri };
}

/**
 * Starts `node dist/index.js` against a fixture with a fresh temp data dir and
 * a connected MCP client. Call `stop()` in `afterAll`.
 */
export async function startServer(options: StartServerOptions = {}): Promise<HesmanTestServer> {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(`${DIST_ENTRY} not found — run \`npm run build\` first`);
  }

  const fixture = options.fixture ?? 'polyglot-basic';
  const projectRoot = isAbsolute(fixture) ? fixture : fixturePath(fixture);
  if (!existsSync(projectRoot)) throw new Error(`Fixture not found: ${projectRoot}`);

  const readyTimeoutMs = options.readyTimeoutMs ?? 60_000;
  const dataDir = await mkdtemp(join(tmpdir(), 'hesman-e2e-'));

  const args = [DIST_ENTRY];
  if (!options.semantic) args.push('--no-semantic');
  if (!options.watch) args.push('--no-watch');
  args.push(...(options.extraArgs ?? []));

  const env: NodeJS.ProcessEnv = { ...process.env, HESMAN_LOG_LEVEL: options.logLevel ?? 'info' };
  if (options.explicitRoot ?? true) env.HESMAN_PROJECT_ROOT = projectRoot;
  else delete env.HESMAN_PROJECT_ROOT;
  if (options.tempDataDir ?? true) env.HESMAN_DATA_DIR = dataDir;
  else delete env.HESMAN_DATA_DIR;
  Object.assign(env, options.env);

  const transport = new RecordingStdioTransport({
    command: process.execPath,
    args,
    cwd: options.cwd ?? projectRoot,
    env,
  });

  const advertisesRoots = options.roots !== undefined;
  const client = new Client(
    { name: 'hesman-e2e', version: '1.0.0' },
    { capabilities: advertisesRoots ? { roots: { listChanged: true } } : {} },
  );
  let currentRoots = options.roots === 'unanswered' ? [] : (options.roots ?? []).map(toRootEntry);
  if (advertisesRoots) {
    client.setRequestHandler(ListRootsRequestSchema, () =>
      options.roots === 'unanswered'
        ? new Promise<never>(() => {}) // a client that advertises roots but never answers
        : Promise.resolve({ roots: currentRoots }),
    );
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      await client.close();
    } catch {
      // Ignore close errors; the process may already be gone.
    }
    await transport.close();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };

  const callTool = async (
    name: string,
    toolArgs: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<CallToolResult> =>
    (await client.callTool({ name, arguments: toolArgs }, undefined, { timeout: timeoutMs })) as CallToolResult;

  const server: HesmanTestServer = {
    client,
    transport,
    projectRoot,
    dataDir,
    stdoutLines: transport.stdoutLines,
    nonProtocolStdoutLines: transport.nonProtocolStdoutLines,
    stderrLines: transport.stderrLines,
    callTool,
    async callToolJson<T = unknown>(name: string, toolArgs?: Record<string, unknown>, timeoutMs?: number) {
      return JSON.parse(toolText(await callTool(name, toolArgs, timeoutMs))) as T;
    },
    waitForIndex: (timeoutMs = readyTimeoutMs) => waitForIndexReady(client, { timeoutMs }),
    async setRoots(roots: readonly string[]) {
      if (!advertisesRoots) throw new Error('setRoots needs the `roots` option of startServer');
      currentRoots = roots.map(toRootEntry);
      await client.sendRootsListChanged();
    },
    stop,
  };

  try {
    const started = Date.now();
    await client.connect(transport, { timeout: readyTimeoutMs });
    if (options.waitForIndex ?? true) {
      await waitForIndexReady(client, { timeoutMs: Math.max(1, readyTimeoutMs - (Date.now() - started)) });
    }
  } catch (err) {
    const output = describeOutput(transport);
    await stop();
    throw new Error(`Failed to start hesman server: ${(err as Error).message}${output}`, { cause: err });
  }

  return server;
}
