/**
 * `hesman ui` end to end: the built binary, started as a second process next
 * to a running MCP server for the same project, serves what that server wrote
 * (index, log file, tool-call log) and runs a tool itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIST_ENTRY, startServer, type HesmanTestServer } from './helpers/server';

interface UiProcess {
  child: ChildProcess;
  origin: string;
  token: string;
  stdout: () => string;
  stderr: () => string;
}

/** Starts `node dist/index.js ui …` and waits for the URL it prints. */
function startUi(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 20_000): Promise<UiProcess> {
  return new Promise((resolveUi, reject) => {
    const child = spawn(process.execPath, [DIST_ENTRY, 'ui', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`hesman ui printed no URL within ${timeoutMs} ms\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = /(http:\/\/127\.0\.0\.1:\d+)\/\?token=([A-Za-z0-9_-]+)/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolveUi({ child, origin: match[1], token: match[2], stdout: () => stdout, stderr: () => stderr });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`hesman ui exited with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit(child.exitCode);
    else child.once('exit', (code) => resolveExit(code));
  });
}

describe('hesman ui (e2e)', () => {
  let mcp: HesmanTestServer;
  let ui: UiProcess;
  let home: string;

  const get = async (path: string, token: string | null = ui.token): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${ui.origin}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, json: await res.json() };
  };

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'hesman-ui-e2e-home-'));
    mcp = await startServer();

    // Calls made by an agent through the MCP server, before the dashboard starts.
    await mcp.callTool('find_symbol', { name: 'tsGreet' });
    await mcp.callTool('get_context', { filePath: 'no/such/file.ts', startLine: 1 });

    ui = await startUi([mcp.projectRoot, '--no-open'], {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HESMAN_DATA_DIR: mcp.dataDir,
      HESMAN_LOG_LEVEL: 'info',
    });
  }, 120_000);

  afterAll(async () => {
    ui?.child.kill('SIGKILL');
    await mcp?.stop();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it('prints a URL on 127.0.0.1 with a token and says what is unavailable', () => {
    expect(ui.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(ui.token.length).toBeGreaterThanOrEqual(40);
    expect(ui.stdout()).toMatch(/semantic_search/);
  });

  it('GET /api/status reports the index the MCP server built', async () => {
    const { status, json } = await get('/api/status');
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.projectRoot).toBe(mcp.projectRoot);
    expect(json.data.dataDir).toBe(mcp.dataDir);
    expect(json.data.index.totalSymbols).toBe(9);
    expect(json.data.index.languages.map((l: { language: string }) => l.language).sort()).toEqual(['go', 'python', 'typescript']);
  });

  it('rejects a request without the token', async () => {
    const { status, json } = await get('/api/status', null);
    expect(status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('shows the tool calls the MCP server recorded', async () => {
    const { json } = await get('/api/calls');
    const calls = json.data.calls as Array<Record<string, unknown>>;
    const ok = calls.find((c) => c.tool === 'find_symbol');
    expect(ok).toMatchObject({ ok: true, errorCode: null, argsPreview: '{"name":"tsGreet"}' });
    expect(typeof ok?.originalTokens).toBe('number');
    expect(typeof ok?.compressedTokens).toBe('number');
    expect(calls.find((c) => c.tool === 'get_context')).toMatchObject({ ok: false, errorCode: 'FILE_NOT_FOUND' });

    const metrics = (await get('/api/metrics?windowMinutes=5')).json.data;
    expect(metrics.summary.calls).toBeGreaterThanOrEqual(2);
    expect(metrics.summary.errors).toBeGreaterThanOrEqual(1);
  });

  it('shows the log lines the MCP server wrote to its log file', async () => {
    expect(existsSync(join(mcp.dataDir, 'logs', 'hesman.log'))).toBe(true);
    const { json } = await get('/api/logs?q=Opening%20project');
    expect(json.data.entries).toMatchObject([{ level: 'info', name: 'hesman', msg: 'Opening project' }]);
  });

  it('runs a tool through the same handlers, without recording it as an MCP call', async () => {
    const before = (await get('/api/calls')).json.data.calls.length;
    const res = await fetch(`${ui.origin}/api/tools/find_symbol`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ui.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: { name: 'GoGreet' } }),
    });
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(json.data.isError).toBe(false);
    expect(json.data.result.symbols[0]).toMatchObject({ name: 'GoGreet', filePath: 'go/greet.go' });
    expect((await get('/api/calls')).json.data.calls.length).toBe(before);
  });

  it('serves the page from dist/ui', async () => {
    const res = await fetch(`${ui.origin}/?token=${ui.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect((await res.text()).toLowerCase()).toContain('<!doctype html>');
  });

  it('leaves the MCP server working and its stdout clean', async () => {
    const found = await mcp.callToolJson<{ symbols: unknown[] }>('find_symbol', { name: 'py_greet' });
    expect(found.symbols).toHaveLength(1);
    expect(mcp.nonProtocolStdoutLines).toEqual([]);
  });

  it('stops on SIGTERM with exit code 0', async () => {
    ui.child.kill('SIGTERM');
    expect(await waitForExit(ui.child)).toBe(0);
  });
});

describe('hesman ui without an index (e2e)', () => {
  it('exits with code 1 and says how to create the index', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hesman-ui-e2e-empty-'));
    try {
      const child = spawn(process.execPath, [DIST_ENTRY, 'ui', dir, '--no-open'], {
        env: { ...process.env, HOME: dir, USERPROFILE: dir, HESMAN_DATA_DIR: join(dir, '.hesman') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      const code = await waitForExit(child);
      clearTimeout(timer);
      expect(code).toBe(1);
      expect(stderr).toMatch(/hesman index/);
      expect(existsSync(join(dir, '.hesman'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
