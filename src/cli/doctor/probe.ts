import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { ProbeRequest, ProbeResult, ProbedProject } from './types.js';

/** How long a stopped server gets to exit before it is killed. Its data directory is temporary. */
const EXIT_GRACE_MS = 2000;
/** stdout and stderr are separate pipes: allow the "Opening project" log line to arrive late. */
const LOG_LINE_WAIT_MS = 500;
const STDERR_TAIL_LINES = 10;

const INITIALIZE_ID = 1;
const PROJECT_CALL_ID = 2;

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Calls `onLine` for every complete line of a stream; `flush` hands over an unterminated rest. */
function lineReader(onLine: (line: string) => void): { push(chunk: Buffer): void; flush(): void } {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) onLine(part.endsWith('\r') ? part.slice(0, -1) : part);
    },
    flush() {
      if (buffer.length > 0) onLine(buffer);
      buffer = '';
    },
  };
}

/** A stderr line as a person would read it: the message of a JSON log line, or the line itself. */
function readable(line: string): string {
  const log = parseJson(line);
  if (!isObject(log) || typeof log.msg !== 'string') return line;
  const err = isObject(log.err) && typeof log.err.message === 'string' ? `: ${log.err.message}` : '';
  return `${log.msg}${err}`;
}

/** The project named by the server's "Opening project" log line, if it wrote one. */
function openedProject(stderrLines: readonly string[]): { root: string; source: string } | undefined {
  for (const line of stderrLines) {
    const log = parseJson(line);
    if (isObject(log) && log.msg === 'Opening project' && typeof log.projectRoot === 'string') {
      return { root: log.projectRoot, source: typeof log.source === 'string' ? log.source : 'unknown' };
    }
  }
  return undefined;
}

/**
 * Starts a server command the way an MCP client does and reports what happened: the time to the
 * `initialize` answer, every stdout line that is not JSON-RPC, and which project the server opens
 * when the client reports no roots (asked with one `index_status` call).
 *
 * The probe changes nothing the user owns: `--no-semantic --no-watch` are appended and the data
 * directory is a temp directory removed afterwards, so no index is written into the project and no
 * embedding model is loaded or downloaded. Never rejects.
 */
export function probeServer(request: ProbeRequest): Promise<ProbeResult> {
  return new Promise((resolveProbe) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hesman-doctor-'));
    const stderrLines: string[] = [];
    const result: ProbeResult = {
      timedOut: false,
      nonProtocolStdout: [],
      stderrTail: [],
      project: { state: 'unknown', reason: 'the server did not start' },
    };

    const startedAt = performance.now();
    const child = spawn(request.command, [...request.args, '--no-semantic', '--no-watch'], {
      cwd: request.cwd,
      env: { ...process.env, HESMAN_DATA_DIR: dataDir, HESMAN_WATCH_MODE: 'false', HESMAN_LOG_LEVEL: 'info' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // `npx` and `hesman` are `.cmd` shims on Windows, which only start through a shell.
      shell: process.platform === 'win32',
    });

    let stopping = false;
    let timer: NodeJS.Timeout | undefined = setTimeout(() => {
      result.timedOut = true;
      stop();
    }, request.timeoutMs);

    const send = (message: JsonObject): void => {
      if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    /** Ends the probe: asks the process to exit, kills it after a grace period. */
    function stop(): void {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
      child.stdin.end();
      child.kill('SIGTERM');
      timer = setTimeout(() => child.kill('SIGKILL'), EXIT_GRACE_MS);
    }

    function decideProject(project: ProbedProject): void {
      result.project = project;
      stop();
    }

    function onProjectAnswer(message: JsonObject): void {
      const answer = message.result;
      if (!isObject(answer)) {
        decideProject({ state: 'unknown', reason: 'the index_status call was rejected' });
        return;
      }
      if (answer.isError === true) {
        const first = Array.isArray(answer.content) ? (answer.content[0] as unknown) : undefined;
        const body = isObject(first) && typeof first.text === 'string' ? parseJson(first.text) : undefined;
        const code = isObject(body) && isObject(body.error) ? body.error.code : undefined;
        decideProject(code === 'NO_PROJECT' ? { state: 'none' } : { state: 'unknown', reason: `index_status answered with the error ${String(code)}` });
        return;
      }
      // A project is open; its path is in the log. Give that line a moment to arrive.
      const deadline = performance.now() + LOG_LINE_WAIT_MS;
      const look = (): void => {
        const opened = openedProject(stderrLines);
        if (opened) decideProject({ state: 'opened', ...opened });
        else if (stopping) return;
        else if (performance.now() >= deadline) decideProject({ state: 'unknown', reason: 'the server did not log which project it opened' });
        else setTimeout(look, 20);
      };
      look();
    }

    const stdout = lineReader((line) => {
      if (line.trim() === '') return;
      const message = parseJson(line);
      if (!isObject(message) || message.jsonrpc !== '2.0') {
        result.nonProtocolStdout.push(line);
        return;
      }
      if (message.id === INITIALIZE_ID && result.handshakeMs === undefined && !stopping) {
        if (!isObject(message.result)) return; // an error answer is not a handshake; the timeout reports it
        result.handshakeMs = Math.max(1, Math.round(performance.now() - startedAt));
        const info = message.result.serverInfo;
        if (isObject(info)) result.server = { name: String(info.name), version: String(info.version) };
        result.project = { state: 'unknown', reason: 'the server did not answer the index_status call' };
        clearTimeout(timer);
        timer = setTimeout(stop, request.timeoutMs);
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: PROJECT_CALL_ID, method: 'tools/call', params: { name: 'index_status', arguments: {} } });
      } else if (message.id === PROJECT_CALL_ID && !stopping) {
        onProjectAnswer(message);
      }
    });
    const stderr = lineReader((line) => stderrLines.push(line));
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => {
      // The process went away while being written to; `exit` / `close` report it.
    });

    function finish(): void {
      clearTimeout(timer);
      stdout.flush();
      stderr.flush();
      result.stderrTail = stderrLines.filter((line) => line.trim() !== '').slice(-STDERR_TAIL_LINES).map(readable);
      rmSync(dataDir, { recursive: true, force: true });
      resolveProbe(result);
    }

    child.once('error', (err) => {
      result.spawnError = err.message;
      stopping = true;
      finish();
    });
    child.once('exit', (code, signal) => {
      // An exit that doctor did not ask for, before the handshake, is a crash on start.
      if (!stopping && result.handshakeMs === undefined) result.exit = { code, signal };
    });
    child.once('close', () => {
      if (result.spawnError === undefined) finish();
    });

    send({
      jsonrpc: '2.0',
      id: INITIALIZE_ID,
      method: 'initialize',
      // No `roots` capability: doctor has no workspace, so the server falls back to its working directory.
      params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'hesman-doctor', version: '1' } },
    });
  });
}
