/* global window, document, location, history, localStorage, sessionStorage, URLSearchParams, fetch */
// Entry point: reads the token and the mock switch from the URL, owns the shell (navigation,
// theme, connection state) and mounts one view at a time.

import { createApi, describeError } from './api.js';
import { h, poll, replace } from './dom.js';
import { parseRoute } from './lib/router.js';
import { indexSummary } from './lib/status-model.js';

const VIEW_MODULES = {
  overview: () => import('./views/overview.js'),
  metrics: () => import('./views/metrics.js'),
  logs: () => import('./views/logs.js'),
  graph: () => import('./views/graph.js'),
  playground: () => import('./views/playground.js'),
};
const TITLES = { overview: 'Overview', metrics: 'Metrics', logs: 'Logs', graph: 'Graph', playground: 'Playground' };
const THEME_KEY = 'hesman.theme';
const TOKEN_KEY = 'hesman.token';

/** Storage that may be missing or blocked (private windows). */
function stored(storage, key, value) {
  try {
    if (value === undefined) return storage.getItem(key);
    storage.setItem(key, value);
  } catch {
    // The setting simply does not persist.
  }
  return null;
}

/** The token arrives as `?token=…`; keep it for reloads of this tab and take it out of the address bar. */
function readToken(query) {
  const fromUrl = query.get('token');
  if (!fromUrl) return stored(sessionStorage, TOKEN_KEY) ?? '';
  stored(sessionStorage, TOKEN_KEY, fromUrl);
  query.delete('token');
  const rest = query.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  return fromUrl;
}

function setUpTheme(button) {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');
  const label = () => {
    button.textContent = current() === 'dark' ? 'Light theme' : 'Dark theme';
  };
  const saved = stored(localStorage, THEME_KEY);
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  label();
  systemDark.addEventListener('change', label);
  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    stored(localStorage, THEME_KEY, next);
    label();
  });
}

async function start() {
  const query = new URLSearchParams(location.search);
  const mock = query.get('mock') === '1';
  const token = readToken(query);
  const viewRoot = document.getElementById('view');
  const connection = document.getElementById('connection');
  const brandProject = document.getElementById('brand-project');
  setUpTheme(document.getElementById('theme-toggle'));

  let fetchImpl = (url, init) => fetch(url, init);
  if (mock) {
    const { createMockFetch } = await import('./mock/mock-server.js');
    fetchImpl = createMockFetch({ scenario: query.get('scenario') ?? 'ready' });
    connection.after(h('p', { className: 'mock-flag' }, 'Mock data, no server'));
  }
  const api = createApi({ fetchImpl, token });

  let unmount = null;
  let blocker = null; // description of the error that hides the views, or null
  let mountedHash = null;
  let lastStatus = null;
  const statusListeners = new Set();

  function setConnection(state, text) {
    connection.dataset.state = state;
    connection.textContent = text;
  }

  function showBlocker(description) {
    blocker = description;
    unmount?.();
    unmount = null;
    mountedHash = null;
    document.title = `${description.title} · Hesman`;
    replace(
      viewRoot,
      h(
        'div',
        { className: 'blocker', role: 'alert' },
        h('h1', {}, description.title),
        h('p', {}, description.detail),
        h('p', { className: 'state' }, h('button', { type: 'button', className: 'btn', onclick: () => statusPoll.now() }, 'Try again')),
      ),
    );
  }

  const ctx = {
    api,
    mock,
    navigate(hash) {
      location.hash = hash;
    },
    /** Views call this with a failed request; true means the whole app is blocked and the view should stop. */
    blocked(err) {
      const description = describeError(err);
      if (!description.blocking) return false;
      setConnection('error', description.title);
      showBlocker(description);
      return true;
    },
    /** Subscribe to `GET /api/status` results; the listener gets the latest known one at once. */
    onStatus(listener) {
      statusListeners.add(listener);
      if (lastStatus) listener(lastStatus);
      return () => statusListeners.delete(listener);
    },
    refreshStatus: () => statusPoll.now(),
  };

  async function mount() {
    if (blocker) return;
    const route = parseRoute(location.hash);
    if (location.hash === mountedHash) return;
    mountedHash = location.hash;
    unmount?.();
    unmount = null;
    for (const link of document.querySelectorAll('.nav a')) {
      if (link.dataset.view === route.view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = `${TITLES[route.view]} · Hesman`;
    const expected = mountedHash;
    const module = await VIEW_MODULES[route.view]();
    if (expected !== mountedHash || blocker) return;
    replace(viewRoot);
    unmount = module.mount(viewRoot, { ...ctx, params: route.params }) ?? null;
  }

  const statusPoll = poll(
    async () => {
      try {
        lastStatus = await api.status();
      } catch (err) {
        const description = describeError(err);
        setConnection('error', description.title);
        if (description.blocking) showBlocker(description);
        return;
      }
      const summary = indexSummary(lastStatus.index);
      setConnection(summary.state, summary.label);
      const name = String(lastStatus.projectRoot ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';
      brandProject.textContent = name;
      brandProject.title = lastStatus.projectRoot ?? '';
      if (blocker) {
        blocker = null;
        await mount();
      }
      for (const listener of statusListeners) listener(lastStatus);
    },
    () => (lastStatus?.index?.indexing?.inProgress ? 1500 : 5000),
  );

  window.addEventListener('hashchange', () => {
    mount();
    viewRoot.focus({ preventScroll: true });
  });
  mount();
}

start();
