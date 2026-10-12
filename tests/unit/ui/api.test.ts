import { describe, expect, it } from 'vitest';
import { ApiError, buildQuery, createApi, describeError } from '../../../src/ui/public/js/api.js';

interface Call {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

function fakeFetch(status: number, body: unknown, calls: Call[] = []) {
  return async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => {
        if (body === 'NOT_JSON') throw new SyntaxError('Unexpected token <');
        return body;
      },
    };
  };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('buildQuery', () => {
  it('omits empty values and encodes the rest', () => {
    expect(buildQuery({ q: 'a b', kind: '', language: undefined, limit: 30, before: null })).toBe('?q=a%20b&limit=30');
    expect(buildQuery({})).toBe('');
  });
});

describe('createApi', () => {
  it('sends the token as a bearer header and unwraps data', async () => {
    const calls: Call[] = [];
    const api = createApi({ fetchImpl: fakeFetch(200, { ok: true, data: { version: '1.2.3' } }, calls), token: 'tok' });
    expect(await api.status()).toEqual({ version: '1.2.3' });
    expect(calls[0].url).toBe('/api/status');
    expect(calls[0].init.headers?.Authorization).toBe('Bearer tok');
  });

  it('sends no Authorization header without a token', async () => {
    const calls: Call[] = [];
    const api = createApi({ fetchImpl: fakeFetch(200, { ok: true, data: {} }, calls), token: '' });
    await api.status();
    expect(calls[0].init.headers?.Authorization).toBeUndefined();
  });

  it('builds the contract URLs', async () => {
    const calls: Call[] = [];
    const api = createApi({ fetchImpl: fakeFetch(200, { ok: true, data: {} }, calls), token: 't' });
    await api.metrics(15);
    await api.calls({ limit: 50, before: 'c9', tool: 'find_symbol' });
    await api.logs({ level: 'warn', q: 'zvec', limit: 200 });
    await api.graphSearch({ q: 'Cart', kind: 'class', limit: 30 });
    await api.neighborhood({ symbolId: 'a/b c', depth: 1, limit: 80 });
    await api.files({ limit: 200 });
    await api.tools();
    expect(calls.map((c) => c.url)).toEqual([
      '/api/metrics?windowMinutes=15',
      '/api/calls?limit=50&before=c9&tool=find_symbol',
      '/api/logs?level=warn&q=zvec&limit=200',
      '/api/graph/search?q=Cart&kind=class&limit=30',
      '/api/graph/neighborhood?symbolId=a%2Fb%20c&depth=1&limit=80',
      '/api/graph/files?limit=200',
      '/api/tools',
    ]);
  });

  it('posts tool arguments as JSON', async () => {
    const calls: Call[] = [];
    const api = createApi({ fetchImpl: fakeFetch(200, { ok: true, data: { isError: false } }, calls), token: 't' });
    await api.runTool('find_symbol', { name: 'Cart' });
    expect(calls[0].url).toBe('/api/tools/find_symbol');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body ?? '')).toEqual({ args: { name: 'Cart' } });
  });
});

describe('error mapping', () => {
  const api = (status: number, body: unknown) => createApi({ fetchImpl: fakeFetch(status, body), token: 't' });

  it('maps 401 to unauthorized', async () => {
    const err = await failure(api(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'token required' } }).status());
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'unauthorized', status: 401, code: 'UNAUTHORIZED', message: 'token required' });
  });

  it('maps 403 to forbidden', async () => {
    expect((await failure(api(403, { ok: false, error: { code: 'FORBIDDEN', message: 'bad host' } }).status())).kind).toBe('forbidden');
  });

  it('maps 404 and 400', async () => {
    expect((await failure(api(404, { ok: false, error: { code: 'NOT_FOUND', message: 'x' } }).status())).kind).toBe('not_found');
    expect((await failure(api(400, { ok: false, error: { code: 'INVALID_INPUT', message: 'x' } }).status())).kind).toBe('bad_request');
  });

  it('maps 5xx to a server error and keeps the server message', async () => {
    const err = await failure(api(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }).status());
    expect(err).toMatchObject({ kind: 'server', message: 'boom' });
  });

  it('maps a rejected fetch to unavailable', async () => {
    const down = createApi({
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
      token: 't',
    });
    expect(await failure(down.status())).toMatchObject({ kind: 'unavailable', status: 0 });
  });

  it('maps a non-JSON body to an invalid response, keeping 401/403', async () => {
    expect((await failure(api(200, 'NOT_JSON').status())).kind).toBe('invalid_response');
    expect((await failure(api(401, 'NOT_JSON').status())).kind).toBe('unauthorized');
  });

  it('treats ok:false with a 200 status as an error', async () => {
    const err = await failure(api(200, { ok: false, error: { code: 'NO_PROJECT', message: 'no project' } }).status());
    expect(err).toMatchObject({ kind: 'server', code: 'NO_PROJECT' });
  });

  it('rejects an envelope without ok', async () => {
    expect((await failure(api(200, { hello: 1 }).status())).kind).toBe('invalid_response');
  });
});

describe('describeError', () => {
  it('explains how to fix a missing token', () => {
    const d = describeError(new ApiError('unauthorized', 401, 'UNAUTHORIZED', 'token required'));
    expect(d.title).toBe('Access token missing or expired');
    expect(d.detail).toContain('hesman ui');
    expect(d.blocking).toBe(true);
  });

  it('explains a stopped server', () => {
    const d = describeError(new ApiError('unavailable', 0, '', 'Failed to fetch'));
    expect(d.title).toBe('Hesman is not reachable');
    expect(d.blocking).toBe(true);
  });

  it('explains a rejected origin', () => {
    expect(describeError(new ApiError('forbidden', 403, 'FORBIDDEN', 'x')).title).toBe('Request refused');
  });

  it('passes server messages through for other errors', () => {
    const d = describeError(new ApiError('server', 500, 'INTERNAL_ERROR', 'boom'));
    expect(d.detail).toContain('boom');
    expect(d.blocking).toBe(false);
  });

  it('explains a tool the dashboard cannot run', () => {
    const d = describeError(new ApiError('bad_request', 409, 'TOOL_UNAVAILABLE', 'semantic_search needs the vector store'));
    expect(d.title).toBe('This tool cannot run in the dashboard');
    expect(d.detail).toContain('semantic_search needs the vector store');
    expect(d.blocking).toBe(false);
  });

  it('explains a request body over the size limit', () => {
    const d = describeError(new ApiError('bad_request', 413, 'PAYLOAD_TOO_LARGE', 'body too large'));
    expect(d.title).toBe('The arguments are too large');
    expect(d.detail).toContain('1 MiB');
  });

  it('handles unknown errors', () => {
    expect(describeError(new Error('weird')).detail).toContain('weird');
  });
});
