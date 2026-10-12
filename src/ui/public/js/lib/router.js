/* global URLSearchParams */
// Hash routes: `#/graph?symbol=<id>`, `#/playground?tool=<name>&args=<json>`. No DOM access.

export const VIEWS = ['overview', 'metrics', 'logs', 'graph', 'playground'];

export function parseRoute(hash) {
  const text = String(hash ?? '').replace(/^#\/?/, '');
  const [name, query = ''] = text.split('?');
  if (!VIEWS.includes(name)) return { view: 'overview', params: {} };
  const params = {};
  for (const [key, value] of new URLSearchParams(query)) params[key] = value;
  return { view: name, params };
}

export function buildRoute(view, params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query ? `#/${view}?${query}` : `#/${view}`;
}

/** Link that opens the playground with a tool selected and its form prefilled. */
export function playgroundRoute(tool, args) {
  return buildRoute('playground', { tool, args: JSON.stringify(args ?? {}) });
}
