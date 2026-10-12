// Client for the `hesman ui` HTTP API (contract: tasks/M3-02-dashboard-frontend.md).
// Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
// `fetchImpl` is injected so the mock backend and the unit tests use the same code path.

/**
 * kind: 'unauthorized' (401) | 'forbidden' (403) | 'not_found' (404) | 'bad_request' (other 4xx)
 *     | 'server' (5xx, or ok:false with a 2xx status) | 'unavailable' (no answer) | 'invalid_response'
 */
export class ApiError extends Error {
  constructor(kind, status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

function kindForStatus(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 400 && status < 500) return 'bad_request';
  return 'server';
}

/** `?a=1&b=two` from an object, skipping undefined, null and empty strings. */
export function buildQuery(params) {
  const parts = Object.entries(params ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function createApi({ fetchImpl, token = '', base = '' }) {
  async function request(path, init = {}) {
    const headers = { Accept: 'application/json', ...(init.headers ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      // `same-origin` also sends the `hesman_ui` cookie the server sets on first load.
      response = await fetchImpl(`${base}${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
    } catch (err) {
      throw new ApiError('unavailable', 0, '', err instanceof Error ? err.message : String(err));
    }

    let body;
    try {
      body = await response.json();
    } catch {
      const blocked = response.status === 401 || response.status === 403;
      throw new ApiError(
        blocked ? kindForStatus(response.status) : 'invalid_response',
        response.status,
        '',
        `The server answered with status ${response.status} and a body that is not JSON.`,
      );
    }

    if (body && body.ok === true) return body.data;
    if (body && body.ok === false) {
      const code = String(body.error?.code ?? '');
      const message = String(body.error?.message ?? `Request failed with status ${response.status}`);
      throw new ApiError(response.status >= 400 ? kindForStatus(response.status) : 'server', response.status, code, message);
    }
    if (response.status >= 400) {
      throw new ApiError(kindForStatus(response.status), response.status, '', `Request failed with status ${response.status}`);
    }
    throw new ApiError('invalid_response', response.status, '', 'The server answer is not in the expected format.');
  }

  return {
    status: () => request('/api/status'),
    metrics: (windowMinutes = 60) => request(`/api/metrics${buildQuery({ windowMinutes })}`),
    calls: ({ limit, before, tool } = {}) => request(`/api/calls${buildQuery({ limit, before, tool })}`),
    logs: ({ level, q, limit, before } = {}) => request(`/api/logs${buildQuery({ level, q, limit, before })}`),
    graphSearch: ({ q, kind, language, limit } = {}) =>
      request(`/api/graph/search${buildQuery({ q, kind, language, limit })}`),
    neighborhood: ({ symbolId, depth, limit } = {}) =>
      request(`/api/graph/neighborhood${buildQuery({ symbolId, depth, limit })}`),
    files: ({ limit } = {}) => request(`/api/graph/files${buildQuery({ limit })}`),
    tools: () => request('/api/tools'),
    runTool: (name, args) =>
      request(`/api/tools/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: args ?? {} }),
      }),
  };
}

/**
 * What to tell the user about a failed request.
 * `blocking` errors concern the whole app (no access, no server), not one request.
 */
export function describeError(err) {
  const kind = err instanceof ApiError ? err.kind : 'unknown';
  const message = err instanceof Error ? err.message : String(err);
  switch (kind) {
    case 'unauthorized':
      return {
        title: 'Access token missing or expired',
        detail:
          'This page only works with the link that `hesman ui` prints, which ends in ?token=…. ' +
          'Open that link again, or restart `hesman ui` to get a new one.',
        blocking: true,
      };
    case 'forbidden':
      return {
        title: 'Request refused',
        detail:
          'Hesman only answers pages opened at 127.0.0.1 or localhost on its own port. ' +
          'Open the exact link that `hesman ui` printed.',
        blocking: true,
      };
    case 'unavailable':
      return {
        title: 'Hesman is not reachable',
        detail: 'The `hesman ui` process has stopped or is restarting. Start it again; this page reconnects by itself.',
        blocking: true,
      };
    case 'invalid_response':
      return { title: 'Unexpected answer from the server', detail: message, blocking: false };
    case 'not_found':
      return { title: 'Not found', detail: message, blocking: false };
    case 'bad_request':
      return { title: 'The request was rejected', detail: message, blocking: false };
    default:
      return { title: 'Something went wrong on the server', detail: message, blocking: false };
  }
}
