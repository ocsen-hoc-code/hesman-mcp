import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HesmanConfig } from '../../config/schema.js';
import { InvalidLogCursorError, isLogLevel, readLogEntries, resolveLogFilePath } from '../../diagnostics/log-file.js';
import { readAllToolCalls, readToolCalls, summarizeToolCalls } from '../../diagnostics/tool-call-log.js';
import { supportTier } from '../../parsers/grammar-report.js';
import { McpServer } from '../../server/mcp-server.js';
import { registerAllTools } from '../../server/tools/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  FILE_GRAPH_LIMIT,
  NEIGHBORHOOD_DEPTH,
  NEIGHBORHOOD_LIMIT,
  SEARCH_LIMIT,
  fileGraph,
  neighborhood,
  searchSymbols,
} from './graph.js';
import { IndexUnavailableError, openReadOnlyIndex } from './index-reader.js';
import { relativizePaths } from './relative-paths.js';
import { resolveStaticFile } from './static.js';

/**
 * The HTTP server behind `hesman ui`: a JSON API over a project's index, logs
 * and tool-call log, plus the static dashboard page.
 *
 * It is a separate process from the MCP server and only reads what that
 * server leaves in the data directory: the SQLite index (opened read-only),
 * the log file and the tool-call log. The one thing it runs is
 * `POST /api/tools/:name`, which goes through the same registered handlers as
 * an MCP `tools/call` (`McpServer.callTool`), so argument validation and path
 * confinement are the same code.
 *
 * Access: bound to 127.0.0.1; a random token per start is required for every
 * `/api/*` request; `Host` must be this server and `Origin`, when present,
 * must be this server too (DNS rebinding and cross-site requests). No CORS
 * headers are ever sent. See "Dashboard" in `docs/SECURITY.md`.
 */

const log = createLogger('ui');

const ADDRESS = '127.0.0.1';
const COOKIE_NAME = 'hesman_ui';
const MAX_BODY_BYTES = 1024 * 1024;
/** A request body larger than this is not even drained: the connection is dropped. */
const MAX_DRAIN_BYTES = 32 * 1024 * 1024;

const CALLS_LIMIT = { default: 50, min: 1, max: 500 };
const LOGS_LIMIT = { default: 200, min: 1, max: 1000 };
const METRICS_WINDOW_MINUTES = { default: 60, min: 1, max: 7 * 24 * 60 };

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Scripts only from this server; inline styles are allowed for the charts. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The `index_status` payload with the support tier (`deep` or `structural`)
 * on every entry of `languages`, which the overview shows per language.
 * `index_status` itself keeps the tier in `grammars.languages` only.
 */
function withLanguageTiers(index: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(index.languages)) return index;
  return {
    ...index,
    languages: (index.languages as Array<{ language: string }>).map((row) => ({ ...row, tier: supportTier(row.language) })),
  };
}

/** What this process cannot do, reported by `GET /api/status`. */
const LIMITATIONS = [
  {
    feature: 'semantic_search',
    reason:
      'The vector store can be open in one process only and the MCP server holds its lock; the dashboard also does ' +
      'not load the embedding model. Run semantic_search through the MCP server.',
  },
  {
    feature: 'indexing_progress',
    reason:
      'Indexing progress lives in the memory of the MCP server process. The dashboard shows what is committed to ' +
      'the index so far; `index.indexing` always reports no run in progress.',
  },
  {
    feature: 'writes',
    reason: 'The index is opened read-only: the dashboard never indexes, re-indexes or changes project files.',
  },
] as const;

export interface UiServerOptions {
  projectRoot: string;
  /** Absolute data directory of the project (`<projectRoot>/.hesman` by default). */
  dataDir: string;
  config: HesmanConfig;
  /** 0 picks a free port. */
  port: number;
  /** Directory of the static page. Default: the `ui/` directory this module was built into. */
  staticDir?: string;
  /** Reported by `/api/status`. Default: the version in `package.json`. */
  version?: string;
}

export interface UiServer {
  address: string;
  port: number;
  token: string;
  /** The page, with the token: `http://127.0.0.1:<port>/?token=<token>`. */
  url: string;
  close(): Promise<void>;
}

/** Thrown when the server cannot start; the message is meant for the terminal. */
export class UiStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UiStartError';
  }
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const invalid = (message: string): HttpError => new HttpError(400, 'INVALID_INPUT', message);

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** `dist/ui/` when built; `src/ui/public/` when run from source. */
function defaultStaticDir(): string {
  const uiDir = fileURLToPath(new URL('..', import.meta.url));
  return existsSync(join(uiDir, 'index.html')) ? uiDir : join(uiDir, 'public');
}

function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** An integer query parameter, clamped like the tools' numeric arguments (`server/args.ts`). */
function intParam(
  params: URLSearchParams,
  name: string,
  options: { default: number; min: number; max: number },
): number {
  const raw = params.get(name);
  if (raw === null || raw === '') return options.default;
  if (!/^-?\d{1,15}$/.test(raw)) throw invalid(`${name} must be an integer`);
  return Math.min(options.max, Math.max(options.min, Number(raw)));
}

function numberParam(
  params: URLSearchParams,
  name: string,
  options: { default: number; min: number; max: number },
): number {
  const raw = params.get(name);
  if (raw === null || raw === '') return options.default;
  if (!/^\d{1,15}(\.\d{1,6})?$/.test(raw)) throw invalid(`${name} must be a number`);
  return Math.min(options.max, Math.max(options.min, Number(raw)));
}

/** The request body as text; empty when there is none. Rejects with 413 once it is known to be too large. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // Too large: stop keeping it, but let the client finish so it can read the answer.
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
      else if (size > MAX_DRAIN_BYTES) req.destroy();
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', `The request body is larger than ${MAX_BODY_BYTES} bytes`));
      } else {
        resolveBody(Buffer.concat(chunks).toString('utf-8'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Starts the dashboard server for one project.
 * @throws UiStartError when the project has no usable index or the port is taken.
 */
export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const projectRoot = resolve(options.projectRoot);
  const dataDir = resolve(options.dataDir);
  // The tools read `config.projectRoot` on every call.
  const config: HesmanConfig = { ...options.config, projectRoot };
  const staticDir = options.staticDir ?? defaultStaticDir();
  const version = options.version ?? packageVersion();
  const logPath = resolveLogFilePath(projectRoot, dataDir, config.logFile);
  const token = randomBytes(32).toString('base64url');

  let index: ReturnType<typeof openReadOnlyIndex>;
  try {
    index = openReadOnlyIndex(dataDir);
  } catch (err) {
    if (err instanceof IndexUnavailableError) throw new UiStartError(err.message);
    throw err;
  }

  // The same registration as the MCP server, minus the vector store: no
  // recorder (the tool-call log belongs to the MCP server) and no transport.
  const tools = new McpServer('hesman-ui', version);
  registerAllTools(tools, index.store, undefined, config);

  let port = 0;
  const allowedHosts = (): string[] => [`${ADDRESS}:${port}`, `localhost:${port}`];

  function sendJson(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(body);
  }

  const sendData = (res: ServerResponse, data: unknown): void => sendJson(res, 200, { ok: true, data });

  function sendError(res: ServerResponse, err: HttpError): void {
    sendJson(res, err.status, { ok: false, error: { code: err.code, message: err.message } }, err.headers);
  }

  function assertAuthorized(req: IncomingMessage): void {
    const header = req.headers.authorization;
    const bearer = header && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : undefined;
    const given = bearer ?? cookieValue(req.headers.cookie, COOKIE_NAME);
    if (given === undefined || !sameSecret(given, token)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'A valid dashboard token is required. Open the URL printed by `hesman ui`.');
    }
  }

  // ── API handlers ────────────────────────────────────────────────────

  async function getStatus(): Promise<unknown> {
    const result = await tools.callTool('index_status', {});
    const text = result.content[0]?.text ?? '{}';
    if (result.isError) throw new HttpError(500, 'INTERNAL_ERROR', 'The index status could not be read');
    return {
      version,
      projectRoot,
      dataDir,
      serverTime: new Date().toISOString(),
      index: withLanguageTiers(JSON.parse(text) as Record<string, unknown>),
      limitations: LIMITATIONS,
    };
  }

  function getMetrics(params: URLSearchParams): unknown {
    const windowMinutes = numberParam(params, 'windowMinutes', METRICS_WINDOW_MINUTES);
    return summarizeToolCalls(readAllToolCalls(dataDir), { windowMinutes });
  }

  function getCalls(params: URLSearchParams): unknown {
    const limit = intParam(params, 'limit', CALLS_LIMIT);
    const beforeRaw = params.get('before');
    if (beforeRaw !== null && beforeRaw !== '' && !/^\d{1,16}$/.test(beforeRaw)) {
      throw invalid('before must be the nextBefore of an earlier page');
    }
    const tool = params.get('tool') || undefined;
    return readToolCalls(dataDir, { limit, tool, before: beforeRaw ? Number(beforeRaw) : undefined });
  }

  function getLogs(params: URLSearchParams): unknown {
    const level = params.get('level') || 'info';
    if (!isLogLevel(level)) throw invalid(`level must be one of trace, debug, info, warn, error, fatal`);
    const limit = intParam(params, 'limit', LOGS_LIMIT);
    try {
      const page = readLogEntries(logPath, {
        level,
        limit,
        q: params.get('q') || undefined,
        before: params.get('before') || undefined,
      });
      return relativizePaths(projectRoot, page);
    } catch (err) {
      if (err instanceof InvalidLogCursorError) throw invalid('before must be the nextBefore of an earlier page');
      throw err;
    }
  }

  function getGraphSearch(params: URLSearchParams): unknown {
    const limit = intParam(params, 'limit', SEARCH_LIMIT);
    const symbols = searchSymbols(index.db, projectRoot, {
      q: (params.get('q') ?? '').slice(0, 200),
      kind: params.get('kind') || undefined,
      language: params.get('language') || undefined,
      limit,
    });
    return { symbols };
  }

  function getGraphNeighborhood(params: URLSearchParams): unknown {
    const symbolId = params.get('symbolId');
    if (!symbolId) throw invalid('symbolId is required');
    const depth = intParam(params, 'depth', NEIGHBORHOOD_DEPTH);
    const limit = intParam(params, 'limit', NEIGHBORHOOD_LIMIT);
    const result = neighborhood(index.db, projectRoot, { symbolId, depth, limit });
    if (!result) throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'No symbol has this id');
    return result;
  }

  function getGraphFiles(params: URLSearchParams): unknown {
    return fileGraph(index.db, projectRoot, { limit: intParam(params, 'limit', FILE_GRAPH_LIMIT) });
  }

  async function postTool(req: IncomingMessage, name: string): Promise<unknown> {
    if (!tools.hasTool(name)) {
      if (name === 'semantic_search') {
        throw new HttpError(409, 'TOOL_UNAVAILABLE', `semantic_search is not available in the dashboard. ${LIMITATIONS[0].reason}`);
      }
      throw new HttpError(404, 'NOT_FOUND', 'Unknown tool');
    }

    const text = await readBody(req);
    let args: Record<string, unknown> = {};
    if (text.trim().length > 0) {
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the body as application/json');
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw invalid('The body is not valid JSON');
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw invalid('The body must be a JSON object: { "args": { ... } }');
      }
      const given = (body as { args?: unknown }).args;
      if (given !== undefined && given !== null) {
        if (typeof given !== 'object' || Array.isArray(given)) throw invalid('args must be a JSON object');
        args = given as Record<string, unknown>;
      }
    }

    const started = performance.now();
    const result = await tools.callTool(name, args);
    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    const raw = result.content[0]?.text ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    return { result: relativizePaths(projectRoot, parsed), isError: result.isError === true, durationMs };
  }

  const GET_ROUTES: Record<string, (params: URLSearchParams) => unknown> = {
    '/api/status': getStatus,
    '/api/metrics': getMetrics,
    '/api/calls': getCalls,
    '/api/logs': getLogs,
    '/api/graph/search': getGraphSearch,
    '/api/graph/neighborhood': getGraphNeighborhood,
    '/api/graph/files': getGraphFiles,
    '/api/tools': () => ({ tools: tools.listTools() }),
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, params: URLSearchParams): Promise<void> {
    assertAuthorized(req);

    const get = Object.hasOwn(GET_ROUTES, path) ? GET_ROUTES[path] : undefined;
    if (get) {
      if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET', { Allow: 'GET' });
      sendData(res, await get(params));
      return;
    }

    const toolMatch = /^\/api\/tools\/([^/]+)$/.exec(path);
    if (toolMatch) {
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST', { Allow: 'POST' });
      let name: string;
      try {
        name = decodeURIComponent(toolMatch[1]);
      } catch {
        throw invalid('Malformed tool name');
      }
      sendData(res, await postTool(req, name));
      return;
    }

    throw new HttpError(404, 'NOT_FOUND', 'Unknown API path');
  }

  function handleStatic(req: IncomingMessage, res: ServerResponse, path: string, params: URLSearchParams): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET', { Allow: 'GET, HEAD' });
    }
    const file = resolveStaticFile(staticDir, path);
    if (file.status !== 200) {
      throw new HttpError(file.status, file.status === 400 ? 'INVALID_INPUT' : 'NOT_FOUND', file.message);
    }

    const headers: Record<string, string | number> = {
      ...SECURITY_HEADERS,
      'Content-Type': file.contentType,
      'Content-Length': file.body.length,
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Frame-Options': 'DENY',
    };
    // The page is opened as `/?token=…`; from then on the browser sends the cookie.
    const given = params.get('token');
    if ((path === '/' || path === '/index.html') && given !== null && sameSecret(given, token)) {
      headers['Set-Cookie'] = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`;
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : file.body);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // DNS rebinding: a page on another name that resolves to 127.0.0.1 sends its own Host.
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowedHosts().includes(host)) {
      throw new HttpError(403, 'FORBIDDEN', 'This server only answers requests addressed to 127.0.0.1 or localhost on its own port');
    }
    // Cross-site requests: browsers add Origin to them; it must be this server.
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts().some((allowed) => origin.toLowerCase() === `http://${allowed}`)) {
      throw new HttpError(403, 'FORBIDDEN', 'Requests from another origin are not allowed');
    }

    const url = req.url ?? '';
    if (!url.startsWith('/')) throw invalid('Malformed request target');
    const queryAt = url.indexOf('?');
    const path = queryAt === -1 ? url : url.slice(0, queryAt);
    const params = new URLSearchParams(queryAt === -1 ? '' : url.slice(queryAt + 1));

    if (path === '/api' || path.startsWith('/api/')) {
      await handleApi(req, res, path, params);
    } else {
      handleStatic(req, res, path, params);
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        sendError(res, err);
        return;
      }
      log.error({ error: err instanceof Error ? err.message : String(err), path: (req.url ?? '').split('?')[0] }, 'Request failed');
      sendError(res, new HttpError(500, 'INTERNAL_ERROR', 'The request failed; see the terminal of `hesman ui`'));
    });
  });

  try {
    await new Promise<void>((resolveListening, reject) => {
      server.once('error', reject);
      server.listen(options.port, ADDRESS, () => {
        server.off('error', reject);
        resolveListening();
      });
    });
  } catch (err) {
    index.close();
    const code = (err as NodeJS.ErrnoException).code;
    throw new UiStartError(
      code === 'EADDRINUSE'
        ? `Port ${options.port} is already in use. Pick another one with --port, or omit it to get a free port.`
        : `The dashboard server could not start: ${(err as Error).message}`,
    );
  }
  port = (server.address() as AddressInfo).port;

  let closed = false;
  return {
    address: ADDRESS,
    port,
    token,
    url: `http://${ADDRESS}:${port}/?token=${token}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolveClosed) => {
        server.close(() => resolveClosed());
        server.closeAllConnections();
      });
      index.close();
    },
  };
}
