import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolCallLog } from '../../../src/diagnostics/tool-call-log';
import { resolveLogFilePath } from '../../../src/diagnostics/log-file';
import { SqliteStore } from '../../../src/stores/sqlite';
import { UiStartError, startUiServer, type UiServer } from '../../../src/ui/server/server';
import { makeIndexedProject, rawRequest, type RawRequestOptions, type RawResponse, type TempProject } from './helpers';

const API_GET_ENDPOINTS = [
  '/api/status',
  '/api/metrics',
  '/api/calls',
  '/api/logs',
  '/api/graph/search?q=Greet',
  '/api/graph/neighborhood?symbolId=x',
  '/api/graph/files',
  '/api/tools',
];

describe('hesman ui server', () => {
  let project: TempProject;
  let ui: UiServer;

  /** An authenticated request. */
  const api = (path: string, options: RawRequestOptions = {}): Promise<RawResponse> =>
    rawRequest(ui.port, path, { token: ui.token, ...options });

  const symbolId = async (name: string): Promise<string> => {
    const res = await api(`/api/graph/search?q=${name}`);
    const found = (res.json.data.symbols as Array<{ id: string; name: string }>).find((s) => s.name === name);
    if (!found) throw new Error(`symbol ${name} not found`);
    return found.id;
  };

  beforeAll(async () => {
    project = await makeIndexedProject();

    // What a running MCP server would have left in the data directory.
    const calls = new ToolCallLog(project.dataDir);
    const text = (payload: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
    calls.record({
      tool: 'find_symbol',
      args: { name: 'tsGreet' },
      durationMs: 4,
      result: text({ symbols: [], _meta: { originalTokens: 200, compressedTokens: 50 } }),
    });
    calls.record({
      tool: 'get_context',
      args: { filePath: 'missing.ts', startLine: 1 },
      durationMs: 8,
      result: { ...text({ error: { code: 'FILE_NOT_FOUND', message: 'File not found: missing.ts' } }), isError: true },
    });
    calls.record({
      tool: 'find_symbol',
      args: { name: 'GoGreet' },
      durationMs: 6,
      result: text({ symbols: [], _meta: { originalTokens: 100, compressedTokens: 40 } }),
    });
    calls.close();

    const logPath = resolveLogFilePath(project.projectRoot, project.dataDir, null);
    mkdirSync(join(project.dataDir, 'logs'), { recursive: true });
    const now = Date.now();
    writeFileSync(
      logPath,
      [
        { level: 30, time: now - 3000, pid: 1, hostname: 'h', name: 'hesman', projectRoot: project.projectRoot, msg: 'Opening project' },
        { level: 20, time: now - 2000, pid: 1, hostname: 'h', name: 'sqlite', msg: 'debug detail' },
        { level: 50, time: now - 1000, pid: 1, hostname: 'h', name: 'mcp-server', tool: 'get_context', msg: 'Tool handler error' },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n',
    );

    ui = await startUiServer({
      projectRoot: project.projectRoot,
      dataDir: project.dataDir,
      config: project.config,
      port: 0,
      staticDir: project.staticDir,
      version: '9.9.9',
    });
  });

  afterAll(async () => {
    await ui?.close();
    project?.cleanup();
  });

  // ── Startup ──────────────────────────────────────────────────────────

  describe('startup', () => {
    it('listens on 127.0.0.1 only, on an ephemeral port, with a random token in the URL', () => {
      expect(ui.address).toBe('127.0.0.1');
      expect(ui.port).toBeGreaterThan(0);
      expect(ui.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(ui.url).toBe(`http://127.0.0.1:${ui.port}/?token=${ui.token}`);
    });

    it('uses a new token for every server', async () => {
      const other = await startUiServer({
        projectRoot: project.projectRoot,
        dataDir: project.dataDir,
        config: project.config,
        port: 0,
        staticDir: project.staticDir,
      });
      try {
        expect(other.token).not.toBe(ui.token);
        // A token of another server is not accepted.
        expect((await rawRequest(ui.port, '/api/status', { token: other.token })).status).toBe(401);
      } finally {
        await other.close();
      }
    });

    it('refuses to start without an index and says how to create one', async () => {
      await expect(
        startUiServer({
          projectRoot: project.base,
          dataDir: join(project.base, 'no-such-data-dir'),
          config: project.config,
          port: 0,
          staticDir: project.staticDir,
        }),
      ).rejects.toThrow(UiStartError);
      await expect(
        startUiServer({
          projectRoot: project.base,
          dataDir: join(project.base, 'no-such-data-dir'),
          config: project.config,
          port: 0,
          staticDir: project.staticDir,
        }),
      ).rejects.toThrow(/hesman index/);
    });
  });

  // ── Authentication, Host and Origin ──────────────────────────────────

  describe('access control', () => {
    it.each(API_GET_ENDPOINTS)('answers 401 without a token: GET %s', async (path) => {
      const res = await rawRequest(ui.port, path);
      expect(res.status).toBe(401);
      expect(res.json).toEqual({ ok: false, error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    });

    it('answers 401 without a token: POST /api/tools/:name', async () => {
      const res = await rawRequest(ui.port, '/api/tools/index_status', { method: 'POST', body: { args: {} } });
      expect(res.status).toBe(401);
    });

    it('answers 401 for a wrong token, in the header or the cookie', async () => {
      expect((await rawRequest(ui.port, '/api/status', { token: 'wrong' })).status).toBe(401);
      expect((await rawRequest(ui.port, '/api/status', { token: `${ui.token}x` })).status).toBe(401);
      expect((await rawRequest(ui.port, '/api/status', { headers: { Cookie: 'hesman_ui=wrong' } })).status).toBe(401);
      // The token is not accepted as a query parameter of an API call.
      expect((await rawRequest(ui.port, `/api/status?token=${ui.token}`)).status).toBe(401);
    });

    it('accepts the token as a Bearer header or as the hesman_ui cookie', async () => {
      expect((await rawRequest(ui.port, '/api/status', { token: ui.token })).status).toBe(200);
      const cookie = await rawRequest(ui.port, '/api/status', { headers: { Cookie: `theme=dark; hesman_ui=${ui.token}` } });
      expect(cookie.status).toBe(200);
    });

    it('sets the cookie when the page is loaded with the right token, and only then', async () => {
      const good = await rawRequest(ui.port, `/?token=${ui.token}`);
      expect(good.status).toBe(200);
      const setCookie = String(good.headers['set-cookie']);
      expect(setCookie).toContain(`hesman_ui=${ui.token}`);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Strict');

      expect((await rawRequest(ui.port, '/?token=wrong')).headers['set-cookie']).toBeUndefined();
      expect((await rawRequest(ui.port, '/')).headers['set-cookie']).toBeUndefined();
    });

    it.each([
      ['a foreign host', 'evil.example'],
      ['a foreign host with our port', 'evil.example:PORT'],
      ['our address with another port', '127.0.0.1:1'],
      ['a rebinding-style name', '127.0.0.1.evil.example:PORT'],
      ['our address without a port', '127.0.0.1'],
    ])('answers 403 when Host is %s', async (_label, host) => {
      const headers = { Host: host.replace('PORT', String(ui.port)) };
      const apiRes = await api('/api/status', { headers });
      expect(apiRes.status).toBe(403);
      expect(apiRes.json).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: expect.any(String) } });
      // Static files are covered as well.
      expect((await rawRequest(ui.port, '/', { headers })).status).toBe(403);
    });

    it('accepts localhost:<port> as Host', async () => {
      expect((await api('/api/status', { headers: { Host: `localhost:${ui.port}` } })).status).toBe(200);
    });

    it.each([
      ['another site', 'https://evil.example'],
      ['another port on this machine', 'http://127.0.0.1:1'],
      ['https on our port', 'https://127.0.0.1:PORT'],
      ['an opaque origin', 'null'],
    ])('answers 403 when Origin is %s, even with a valid token', async (_label, origin) => {
      const headers = { Origin: origin.replace('PORT', String(ui.port)) };
      expect((await api('/api/status', { headers })).status).toBe(403);
      const post = await api('/api/tools/index_status', { method: 'POST', body: { args: {} }, headers });
      expect(post.status).toBe(403);
      expect(post.json.error.code).toBe('FORBIDDEN');
    });

    it('accepts its own origin', async () => {
      expect((await api('/api/status', { headers: { Origin: `http://127.0.0.1:${ui.port}` } })).status).toBe(200);
      expect((await api('/api/status', { headers: { Origin: `http://localhost:${ui.port}` } })).status).toBe(200);
    });

    it('sends no CORS headers', async () => {
      const res = await api('/api/status', { headers: { Origin: `http://127.0.0.1:${ui.port}` } });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // ── API ──────────────────────────────────────────────────────────────

  describe('GET /api/status', () => {
    it('returns version, project, data directory, server time and the index_status payload', async () => {
      const res = await api('/api/status');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json.ok).toBe(true);
      const data = res.json.data;
      expect(data.version).toBe('9.9.9');
      expect(data.projectRoot).toBe(project.projectRoot);
      expect(data.dataDir).toBe(project.dataDir);
      expect(Number.isNaN(Date.parse(data.serverTime))).toBe(false);
      expect(data.index).toMatchObject({
        totalFiles: 6,
        totalSymbols: 9,
        indexing: { inProgress: false },
        health: { sqliteOk: true, zvecOk: false },
        textTier: { files: expect.any(Number) },
      });
      expect(data.index.languages.map((l: { language: string }) => l.language).sort()).toEqual(['go', 'python', 'typescript']);
    });

    it('states what this process cannot do', async () => {
      const { limitations } = (await api('/api/status')).json.data;
      const features = (limitations as Array<{ feature: string; reason: string }>).map((l) => l.feature);
      expect(features).toContain('semantic_search');
      expect(features).toContain('indexing_progress');
      expect(limitations.every((l: { reason: string }) => l.reason.length > 20)).toBe(true);
    });
  });

  describe('GET /api/metrics', () => {
    it('summarizes the recorded tool calls', async () => {
      const { data } = (await api('/api/metrics?windowMinutes=60')).json;
      expect(data.summary).toEqual({ calls: 3, errors: 1, p50Ms: 6, p95Ms: 8, tokensOriginal: 300, tokensReturned: 90 });
      expect(data.byTool).toEqual([
        { tool: 'find_symbol', calls: 2, errors: 0, avgMs: 5, p95Ms: 6, tokensOriginal: 300, tokensReturned: 90 },
        { tool: 'get_context', calls: 1, errors: 1, avgMs: 8, p95Ms: 8, tokensOriginal: 0, tokensReturned: 0 },
      ]);
      expect(data.series.reduce((sum: number, b: { calls: number }) => sum + b.calls, 0)).toBe(3);
      expect(Object.keys(data.series[0]).sort()).toEqual(['avgMs', 'calls', 'errors', 't']);
    });

    it('defaults to a 60-minute window and rejects a window that is not a number', async () => {
      expect((await api('/api/metrics')).json.data.summary.calls).toBe(3);
      const bad = await api('/api/metrics?windowMinutes=soon');
      expect(bad.status).toBe(400);
      expect(bad.json.error.code).toBe('INVALID_INPUT');
    });
  });

  describe('GET /api/calls', () => {
    it('lists the calls newest first with the contract fields', async () => {
      const { data } = (await api('/api/calls')).json;
      expect(data.calls.map((c: { tool: string }) => c.tool)).toEqual(['find_symbol', 'get_context', 'find_symbol']);
      expect(data.calls[1]).toEqual({
        id: expect.any(Number),
        time: expect.any(String),
        tool: 'get_context',
        durationMs: 8,
        ok: false,
        errorCode: 'FILE_NOT_FOUND',
        originalTokens: null,
        compressedTokens: null,
        argsPreview: '{"filePath":"missing.ts","startLine":1}',
      });
      expect(data.nextBefore).toBeNull();
    });

    it('pages with limit and before, and filters by tool', async () => {
      const first = (await api('/api/calls?limit=2')).json.data;
      expect(first.calls).toHaveLength(2);
      expect(first.nextBefore).toBe(first.calls[1].id);
      const second = (await api(`/api/calls?limit=2&before=${first.nextBefore}`)).json.data;
      expect(second.calls).toHaveLength(1);
      expect(second.nextBefore).toBeNull();

      const filtered = (await api('/api/calls?tool=get_context')).json.data;
      expect(filtered.calls.map((c: { tool: string }) => c.tool)).toEqual(['get_context']);
    });

    it('rejects a limit or cursor that is not an integer', async () => {
      expect((await api('/api/calls?limit=many')).status).toBe(400);
      expect((await api('/api/calls?before=1.5')).status).toBe(400);
    });
  });

  describe('GET /api/logs', () => {
    it('returns the log entries newest first, without the host name', async () => {
      const { data } = (await api('/api/logs?level=debug')).json;
      expect(data.entries.map((e: { msg: string }) => e.msg)).toEqual(['Tool handler error', 'debug detail', 'Opening project']);
      expect(data.entries[0]).toEqual({
        time: expect.any(String),
        level: 'error',
        name: 'mcp-server',
        msg: 'Tool handler error',
        fields: { pid: 1, tool: 'get_context' },
      });
      expect(data.nextBefore).toBeNull();
    });

    it('filters by level (default info) and by text', async () => {
      expect((await api('/api/logs')).json.data.entries.map((e: { level: string }) => e.level)).toEqual(['error', 'info']);
      expect((await api('/api/logs?level=error')).json.data.entries).toHaveLength(1);
      expect((await api('/api/logs?level=debug&q=DETAIL')).json.data.entries.map((e: { msg: string }) => e.msg)).toEqual([
        'debug detail',
      ]);
    });

    it('pages with limit and before', async () => {
      const first = (await api('/api/logs?level=trace&limit=2')).json.data;
      expect(first.entries).toHaveLength(2);
      const second = (await api(`/api/logs?level=trace&limit=2&before=${encodeURIComponent(first.nextBefore)}`)).json.data;
      expect(second.entries.map((e: { msg: string }) => e.msg)).toEqual(['Opening project']);
    });

    it('rejects an unknown level and a malformed cursor', async () => {
      expect((await api('/api/logs?level=loud')).status).toBe(400);
      expect((await api('/api/logs?before=garbage')).status).toBe(400);
    });

    it('makes paths below the project root relative', async () => {
      const { data } = (await api('/api/logs?q=Opening')).json;
      expect(data.entries[0].fields.projectRoot).toBe('.');
    });
  });

  describe('GET /api/graph/search', () => {
    it('finds symbols by a case-insensitive part of the name', async () => {
      const { data } = (await api('/api/graph/search?q=greet')).json;
      expect(data.symbols.map((s: { name: string }) => s.name).sort()).toEqual(['GoGreet', 'py_greet', 'tsGreet']);
      const ts = data.symbols.find((s: { name: string }) => s.name === 'tsGreet');
      expect(ts).toEqual({
        id: expect.any(String),
        name: 'tsGreet',
        kind: 'function',
        filePath: 'ts/greet.ts',
        startLine: 5,
        endLine: 7,
        language: 'typescript',
        isExported: true,
      });
    });

    it('ranks an exact name before names that merely contain the text', async () => {
      const { data } = (await api('/api/graph/search?q=main')).json;
      expect(data.symbols[0].name).toBe('main');
      expect(data.symbols.map((s: { name: string }) => s.name).sort()).toEqual(['main', 'py_main', 'tsMain']);
    });

    it('filters by kind and language and honors the limit', async () => {
      expect((await api('/api/graph/search?q=greet&language=go')).json.data.symbols.map((s: { name: string }) => s.name)).toEqual([
        'GoGreet',
      ]);
      expect((await api('/api/graph/search?q=greet&kind=class')).json.data.symbols).toEqual([]);
      expect((await api('/api/graph/search?q=greet&limit=2')).json.data.symbols).toHaveLength(2);
      // Out of range is clamped, like the tools' numeric arguments.
      expect((await api('/api/graph/search?q=&limit=100000')).json.data.symbols).toHaveLength(9);
      expect((await api('/api/graph/search?q=greet&limit=0')).json.data.symbols).toHaveLength(1);
    });

    it('lists symbols when the query is empty, and treats LIKE wildcards as text', async () => {
      expect((await api('/api/graph/search')).json.data.symbols).toHaveLength(9);
      expect((await api('/api/graph/search?q=%25')).json.data.symbols).toEqual([]);
      expect((await api('/api/graph/search?q=py_')).json.data.symbols.map((s: { name: string }) => s.name).sort()).toEqual([
        'py_format_name',
        'py_greet',
        'py_main',
      ]);
    });

    it('rejects a limit that is not an integer', async () => {
      const res = await api('/api/graph/search?q=greet&limit=ten');
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('INVALID_INPUT');
    });
  });

  describe('GET /api/graph/neighborhood', () => {
    it('returns the callers and callees of a symbol with 1-based call lines', async () => {
      const id = await symbolId('tsGreet');
      const { data } = (await api(`/api/graph/neighborhood?symbolId=${id}`)).json;

      expect(data.center).toEqual({
        id,
        name: 'tsGreet',
        kind: 'function',
        filePath: 'ts/greet.ts',
        startLine: 5,
        language: 'typescript',
      });
      expect(data.nodes.map((n: { name: string }) => n.name).sort()).toEqual(['tsFormatName', 'tsGreet', 'tsMain']);
      const byId = new Map<string, string>(data.nodes.map((n: { id: string; name: string }) => [n.id, n.name]));
      const edges = data.edges.map((e: { from: string; to: string; kind: string; line: number }) => ({
        from: byId.get(e.from),
        to: byId.get(e.to),
        kind: e.kind,
        line: e.line,
      }));
      expect(edges).toHaveLength(2);
      expect(edges).toContainEqual({ from: 'tsMain', to: 'tsGreet', kind: 'calls', line: 4 });
      expect(edges).toContainEqual({ from: 'tsGreet', to: 'tsFormatName', kind: 'calls', line: 6 });
      expect(data.truncated).toBe(false);
    });

    it('follows relations up to the requested depth', async () => {
      const id = await symbolId('tsMain');
      const one = (await api(`/api/graph/neighborhood?symbolId=${id}&depth=1`)).json.data;
      expect(one.nodes.map((n: { name: string }) => n.name).sort()).toEqual(['tsGreet', 'tsMain']);
      const two = (await api(`/api/graph/neighborhood?symbolId=${id}&depth=2`)).json.data;
      expect(two.nodes.map((n: { name: string }) => n.name).sort()).toEqual(['tsFormatName', 'tsGreet', 'tsMain']);
      expect(two.edges).toHaveLength(2);
    });

    it('stops at the node limit and says so', async () => {
      const id = await symbolId('tsGreet');
      const { data } = (await api(`/api/graph/neighborhood?symbolId=${id}&limit=2`)).json;
      expect(data.nodes).toHaveLength(2);
      expect(data.truncated).toBe(true);
      // Every edge connects two returned nodes.
      const ids = new Set(data.nodes.map((n: { id: string }) => n.id));
      expect(data.edges.every((e: { from: string; to: string }) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    });

    it('answers 400 without a symbol id and 404 for an unknown one', async () => {
      const missing = await api('/api/graph/neighborhood');
      expect(missing.status).toBe(400);
      expect(missing.json.error.code).toBe('INVALID_INPUT');
      const unknown = await api('/api/graph/neighborhood?symbolId=does-not-exist');
      expect(unknown.status).toBe(404);
      expect(unknown.json.error.code).toBe('SYMBOL_NOT_FOUND');
      expect((await api('/api/graph/neighborhood?symbolId=x&depth=deep')).status).toBe(400);
    });
  });

  describe('GET /api/graph/files', () => {
    it('returns one node per indexed file and the call/import edges between files', async () => {
      const { data } = (await api('/api/graph/files')).json;
      expect(data.nodes.map((n: { id: string }) => n.id).sort()).toEqual([
        'go/greet.go',
        'go/main.go',
        'py/greet.py',
        'py/main.py',
        'ts/greet.ts',
        'ts/main.ts',
      ]);
      expect(data.nodes.find((n: { id: string }) => n.id === 'ts/greet.ts')).toEqual({
        id: 'ts/greet.ts',
        language: 'typescript',
        symbols: 2,
      });
      // ts/main.ts calls tsGreet once and imports ./greet.js once.
      expect(data.edges).toContainEqual({ from: 'ts/main.ts', to: 'ts/greet.ts', count: 2 });
      expect(data.edges).toContainEqual({ from: 'go/main.go', to: 'go/greet.go', count: 1 });
      expect(data.edges).toContainEqual({ from: 'py/main.py', to: 'py/greet.py', count: 1 });
      expect(data.edges.every((e: { from: string; to: string }) => e.from !== e.to)).toBe(true);
      expect(data.truncated).toBe(false);
    });

    it('stops at the node limit, keeps only edges between returned files, and says so', async () => {
      const { data } = (await api('/api/graph/files?limit=2')).json;
      expect(data.nodes).toHaveLength(2);
      expect(data.truncated).toBe(true);
      const ids = new Set(data.nodes.map((n: { id: string }) => n.id));
      expect(data.edges.every((e: { from: string; to: string }) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    });
  });

  describe('GET /api/tools', () => {
    it('lists the registered tools with their input schemas', async () => {
      const { data } = (await api('/api/tools')).json;
      const names = data.tools.map((t: { name: string }) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'find_symbol',
          'get_file_structure',
          'get_references',
          'get_callers',
          'get_callees',
          'get_context',
          'list_dependencies',
          'impact_analysis',
          'find_pattern',
          'index_status',
        ]),
      );
      const findSymbol = data.tools.find((t: { name: string }) => t.name === 'find_symbol');
      expect(findSymbol.description.length).toBeGreaterThan(0);
      expect(findSymbol.inputSchema).toMatchObject({ type: 'object', required: ['name'] });
    });

    it('does not offer semantic_search, which this process cannot run', async () => {
      const { data } = (await api('/api/tools')).json;
      expect(data.tools.map((t: { name: string }) => t.name)).not.toContain('semantic_search');
    });
  });

  describe('POST /api/tools/:name', () => {
    const run = (name: string, body: unknown): Promise<RawResponse> => api(`/api/tools/${name}`, { method: 'POST', body });

    it('runs a tool and returns its JSON with _meta, relative paths and the duration', async () => {
      const res = await run('find_symbol', { args: { name: 'tsGreet' } });
      expect(res.status).toBe(200);
      const { data } = res.json;
      expect(data.isError).toBe(false);
      expect(typeof data.durationMs).toBe('number');
      expect(data.result.symbols).toHaveLength(1);
      expect(data.result.symbols[0]).toMatchObject({ name: 'tsGreet', filePath: 'ts/greet.ts', startLine: 5 });
      expect(data.result._meta).toMatchObject({ originalTokens: expect.any(Number), compressedTokens: expect.any(Number) });
      expect(res.text).not.toContain(project.projectRoot);
    });

    it('treats a missing body or missing args as no arguments', async () => {
      const res = await api('/api/tools/index_status', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(res.json.data.result.totalSymbols).toBe(9);
    });

    it('validates arguments exactly as the MCP tool does', async () => {
      const res = await run('find_symbol', { args: { name: 'tsGreet', topK: 'many' } });
      expect(res.status).toBe(200);
      expect(res.json.data.isError).toBe(true);
      expect(res.json.data.result.error.code).toBe('INVALID_INPUT');
    });

    it('keeps file access inside the project', async () => {
      const outside = await run('get_context', { args: { filePath: '../outside-secret.txt', startLine: 1 } });
      expect(outside.json.data.isError).toBe(true);
      expect(outside.json.data.result.error.code).toBe('PATH_OUTSIDE_PROJECT');
      expect(outside.text).not.toContain('TOP-SECRET-OUTSIDE');

      const absolute = await run('get_context', { args: { filePath: join(project.base, 'outside-secret.txt'), startLine: 1 } });
      expect(absolute.json.data.result.error.code).toBe('PATH_OUTSIDE_PROJECT');
      expect(absolute.text).not.toContain('TOP-SECRET-OUTSIDE');
    });

    it('reads a file inside the project through a relative path', async () => {
      const res = await run('get_context', { args: { filePath: 'ts/greet.ts', startLine: 5 } });
      expect(res.json.data.isError).toBe(false);
      expect(res.json.data.result.filePath).toBe('ts/greet.ts');
      expect(res.json.data.result.content).toContain('tsGreet');
    });

    it('answers 404 for an unknown tool and 409 for semantic_search with the reason', async () => {
      const unknown = await run('no_such_tool', { args: {} });
      expect(unknown.status).toBe(404);
      expect(unknown.json.error.code).toBe('NOT_FOUND');

      const semantic = await run('semantic_search', { args: { query: 'greeting' } });
      expect(semantic.status).toBe(409);
      expect(semantic.json.error.code).toBe('TOOL_UNAVAILABLE');
      expect(semantic.json.error.message).toMatch(/MCP server/);
    });

    it('rejects bodies that are not a JSON object with an args object', async () => {
      const notJson = await api('/api/tools/index_status', {
        method: 'POST',
        rawBody: '{broken',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(notJson.status).toBe(400);
      expect(notJson.json.error.code).toBe('INVALID_INPUT');

      expect((await run('index_status', [1, 2])).status).toBe(400);
      expect((await run('index_status', { args: 'name=x' })).status).toBe(400);
      expect((await run('index_status', { args: [1] })).status).toBe(400);
    });

    it('rejects a body that is not sent as application/json', async () => {
      const res = await api('/api/tools/index_status', {
        method: 'POST',
        rawBody: '{"args":{}}',
        headers: { 'Content-Type': 'text/plain' },
      });
      expect(res.status).toBe(415);
    });

    it('rejects an oversized body', async () => {
      const res = await run('find_symbol', { args: { name: 'x'.repeat(2 * 1024 * 1024) } });
      expect(res.status).toBe(413);
    });

    it('does not record its own calls in the tool-call log of the MCP server', async () => {
      await run('find_symbol', { args: { name: 'tsGreet' } });
      expect((await api('/api/calls')).json.data.calls).toHaveLength(3);
    });
  });

  describe('routing', () => {
    it('answers 404 for an unknown API path and 405 for a wrong method', async () => {
      const unknown = await api('/api/nope');
      expect(unknown.status).toBe(404);
      expect(unknown.json).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: expect.any(String) } });

      expect((await api('/api/status', { method: 'POST', body: {} })).status).toBe(405);
      expect((await api('/api/tools/index_status')).status).toBe(405);
      expect((await api('/api/status', { method: 'DELETE' })).status).toBe(405);
    });

    it('never changes the index: writes through the store it opened fail', async () => {
      const before = statSync(join(project.dataDir, 'symbols.db')).mtimeMs;
      await api('/api/tools/find_symbol', { method: 'POST', body: { args: { name: 'tsGreet' } } });
      await api('/api/graph/files');
      expect(statSync(join(project.dataDir, 'symbols.db')).mtimeMs).toBe(before);
    });

    it('sees what another process writes to the index while it runs', async () => {
      // Stands in for the MCP server: a second, writing connection to the same database.
      const writer = new SqliteStore(project.dataDir);
      writer.open();
      try {
        writer.upsertSymbols([
          {
            id: 'live-symbol-id',
            name: 'addedWhileUiRuns',
            kind: 'function',
            file_path: join(project.projectRoot, 'ts', 'live.ts'),
            start_line: 1,
            end_line: 2,
            start_col: 0,
            end_col: 0,
            signature: null,
            doc_comment: null,
            parent_id: null,
            language: 'typescript',
            is_exported: 1,
            updated_at: Date.now(),
          },
        ]);
        const found = (await api('/api/graph/search?q=addedWhileUiRuns')).json.data.symbols;
        expect(found).toMatchObject([{ id: 'live-symbol-id', filePath: 'ts/live.ts' }]);
      } finally {
        writer.clearSymbols(join(project.projectRoot, 'ts', 'live.ts'));
        writer.close();
      }
    });
  });

  // ── Static files ─────────────────────────────────────────────────────

  describe('static files', () => {
    it('serves index.html at / with security headers and without a token', async () => {
      const res = await rawRequest(ui.port, '/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('Hesman test page');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
      expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    });

    it('serves files with their content type', async () => {
      const js = await rawRequest(ui.port, '/assets/app.js');
      expect(js.status).toBe(200);
      expect(js.headers['content-type']).toContain('javascript');
      expect(js.text).toBe('console.log("app");');
      expect((await rawRequest(ui.port, '/assets/style.css')).headers['content-type']).toContain('text/css');
    });

    it('answers HEAD without a body', async () => {
      const res = await rawRequest(ui.port, '/assets/app.js', { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.text).toBe('');
    });

    it.each([
      '/../outside-secret.txt',
      '/assets/../../outside-secret.txt',
      '/%2e%2e/outside-secret.txt',
      '/..%2foutside-secret.txt',
      '/assets/..%2f..%2foutside-secret.txt',
      '/..%5coutside-secret.txt',
      '/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd',
      '//etc/passwd',
      '/assets/%00/../../outside-secret.txt',
      '/%zz',
    ])('does not serve anything outside the UI directory: %s', async (path) => {
      const res = await rawRequest(ui.port, path);
      expect([400, 404]).toContain(res.status);
      expect(res.text).not.toContain('TOP-SECRET-OUTSIDE');
      expect(res.text).not.toContain('root:');
    });

    it('does not follow a symlink that leaves the UI directory', async () => {
      symlinkSync(join(project.base, 'outside-secret.txt'), join(project.staticDir, 'assets', 'link.txt'));
      const res = await rawRequest(ui.port, '/assets/link.txt');
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('TOP-SECRET-OUTSIDE');
    });

    it('has no directory listing', async () => {
      for (const path of ['/assets', '/assets/']) {
        const res = await rawRequest(ui.port, path);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('app.js');
      }
    });

    it('does not serve the compiled server code or dotfiles', async () => {
      expect((await rawRequest(ui.port, '/server/server.js')).status).toBe(404);
      expect((await rawRequest(ui.port, '/.hidden')).status).toBe(404);
    });

    it('answers 404 as JSON for a missing file and 405 for a write', async () => {
      const missing = await rawRequest(ui.port, '/nope.js');
      expect(missing.status).toBe(404);
      expect(missing.json.ok).toBe(false);
      expect((await rawRequest(ui.port, '/assets/app.js', { method: 'PUT', rawBody: 'x' })).status).toBe(405);
    });

    it('serves the placeholder page committed in src/ui/public by default', async () => {
      const page = readFileSync(join(__dirname, '..', '..', '..', 'src', 'ui', 'public', 'index.html'), 'utf-8');
      expect(page.toLowerCase()).toContain('<!doctype html>');
    });
  });
});
