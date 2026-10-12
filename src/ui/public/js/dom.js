/* global document, SVGElement, Node, setTimeout, clearTimeout */
// Small DOM helpers. Text always goes in through text nodes, never through HTML strings,
// because symbol names, paths and log messages come from the indexed project.

const SVG_NS = 'http://www.w3.org/2000/svg';

function build(element, attrs, children) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key in element && !(element instanceof SVGElement) && key !== 'list' && key !== 'form') element[key] = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** Create an HTML element: `h('p', { className: 'muted' }, 'text', child)`. */
export const h = (tag, attrs, ...children) => build(document.createElement(tag), attrs, children);

/** Create an SVG element. */
export const s = (tag, attrs, ...children) => build(document.createElementNS(SVG_NS, tag), attrs, children);

export function replace(container, ...children) {
  container.replaceChildren(...children.flat(Infinity).filter((c) => c !== undefined && c !== null && c !== false));
}

export const loadingState = (what) => h('p', { className: 'state', role: 'status' }, `Loading ${what}…`);

export const emptyState = (title, detail) =>
  h('div', { className: 'state' }, h('h3', {}, title), detail ? h('p', {}, detail) : null);

/** Inline error for one failed request, with a retry button. */
export function errorState(description, onRetry) {
  return h(
    'div',
    { className: 'state state-error', role: 'alert' },
    h('h3', {}, description.title),
    h('p', {}, description.detail),
    onRetry ? h('button', { type: 'button', className: 'btn', onclick: onRetry }, 'Try again') : null,
  );
}

/** A status mark: shape + label. state: ok | busy | warn | error | pending. */
export const mark = (state, label) => h('span', { className: 'mark', dataset: { state } }, label);

/**
 * A table from column definitions: `{ label, num?, code?, cell: (row) => node|string }`.
 * The caption is for screen readers and is visually hidden.
 */
export function dataTable(caption, columns, rows, rowAttrs) {
  return h(
    'div',
    { className: 'table-wrap' },
    h(
      'table',
      { className: 'data' },
      h('caption', { className: 'sr-only' }, caption),
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', className: c.num ? 'num' : '' }, c.label)))),
      h(
        'tbody',
        {},
        rows.map((row) =>
          h('tr', rowAttrs ? rowAttrs(row) : {}, columns.map((c) => h('td', { className: [c.num ? 'num' : '', c.code ? 'code' : ''].join(' ').trim() }, c.cell(row)))),
        ),
      ),
    ),
  );
}

/**
 * Run `task` now and then every `intervalMs()` while the page is visible.
 * Returns `{ stop, now, setPaused }`. `task` must handle its own errors.
 */
export function poll(task, intervalMs) {
  let timer = null;
  let stopped = false;
  let paused = false;
  let running = false;

  async function tick() {
    timer = null;
    if (stopped) return;
    if (!paused && !document.hidden && !running) {
      running = true;
      try {
        await task();
      } finally {
        running = false;
      }
    }
    if (!stopped) timer = setTimeout(tick, typeof intervalMs === 'function' ? intervalMs() : intervalMs);
  }

  const now = () => {
    clearTimeout(timer);
    return tick();
  };
  const onVisible = () => {
    if (!document.hidden) now();
  };
  document.addEventListener('visibilitychange', onVisible);
  tick();

  return {
    now,
    setPaused(value) {
      paused = value;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}

/** Call `fn` once the calls stop for `ms` milliseconds. */
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
