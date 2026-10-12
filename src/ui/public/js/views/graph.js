// Graph explorer: a symbol's neighborhood that grows as nodes are clicked, or the file-level graph.
// Data: GET /api/graph/search, /api/graph/neighborhood, /api/graph/files; the signature in the
// details panel comes from the find_symbol tool (POST /api/tools/find_symbol).

import { describeError } from '../api.js';
import { debounce, emptyState, errorState, h, loadingState, replace } from '../dom.js';
import { createGraphCanvas } from '../graph-canvas.js';
import { detailsPanel } from './graph-details.js';
import { formatCount } from '../lib/format.js';
import { layoutGraph } from '../lib/graph-layout.js';
import { MAX_GRAPH_NODES, emptyGraph, fileGraphFromPayload, mergeNeighborhood } from '../lib/graph-model.js';

const SYMBOL_KINDS = ['function', 'class', 'method', 'variable', 'interface', 'type', 'enum', 'namespace', 'constant'];
const NEIGHBOR_LIMIT = 80;
const FILE_LIMIT = 200;

/** The drawing area grows with the node count so ~100 nodes keep their distance. */
function sizeFor(count) {
  const scale = Math.max(1, Math.sqrt(count / 55));
  return { width: Math.round(1000 * scale), height: Math.round(640 * scale) };
}

export function mount(container, ctx) {
  let mode = ctx.params.mode === 'files' ? 'files' : 'symbols';
  let graph = emptyGraph();
  let positions = new Map();
  let selectedId = null;
  let alive = true;
  let searchRun = 0;
  const signatures = new Map(); // symbol id -> { signature, docComment } | null (not available)

  const canvas = createGraphCanvas({ onSelect: (id) => select(id) });
  const stage = h('div', { className: 'graph-stage' });
  const notices = h('div', { className: 'graph-notices', role: 'status' });
  const details = h('aside', { className: 'graph-details', 'aria-label': 'Details of the selected node' });
  const results = h('ul', { className: 'search-results', 'aria-label': 'Search results' });
  const searchState = h('p', { className: 'muted', role: 'status' });
  const kindSelect = h('select', { id: 'graph-kind', onchange: () => search() }, h('option', { value: '' }, 'Any kind'), SYMBOL_KINDS.map((k) => h('option', { value: k }, k)));
  const searchInput = h('input', { type: 'search', id: 'graph-q', placeholder: 'Symbol name', autocomplete: 'off', oninput: debounce(() => search(), 250) });
  const searchPanel = h(
    'div',
    { className: 'graph-search' },
    h('div', { className: 'toolbar' }, h('div', { className: 'field field-grow' }, h('label', { htmlFor: 'graph-q' }, 'Find a symbol'), searchInput), h('div', { className: 'field' }, h('label', { htmlFor: 'graph-kind' }, 'Kind'), kindSelect)),
    searchState,
    results,
  );
  const modeButtons = [
    ['symbols', 'Symbols'],
    ['files', 'Files'],
  ].map(([value, label]) => h('button', { type: 'button', className: 'btn', 'aria-pressed': String(value === mode), dataset: { mode: value }, onclick: () => setMode(value) }, label));

  function redraw(anchorId) {
    const size = sizeFor(graph.nodes.length);
    // New nodes start next to the node they were reached from, so the drawing grows instead of jumping.
    const anchor = anchorId ? positions.get(anchorId) : null;
    const start = new Map(positions);
    if (anchor) {
      graph.nodes.forEach((node, i) => {
        if (!start.has(node.id)) start.set(node.id, { x: anchor.x + 30 * Math.cos(i * 2.4), y: anchor.y + 30 * Math.sin(i * 2.4) });
      });
    }
    positions = layoutGraph(graph.nodes, graph.edges, { ...size, positions: start.size > 0 ? start : undefined, fixedId: graph.rootId ?? undefined, iterations: anchor ? 140 : 260, padding: 40 });
    canvas.draw(graph, positions, size, selectedId);
    renderNotices();
    renderDetails();
  }

  function renderNotices() {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const list = [];
    if (graph.truncated.length > 0) {
      const names = graph.truncated.map((id) => byId.get(id)?.name ?? id);
      list.push(`Incomplete: only the first ${NEIGHBOR_LIMIT} connections are drawn for ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}. Use the playground links in the details for the full lists.`);
    }
    if (graph.capped) list.push(`Incomplete: the drawing is full at ${MAX_GRAPH_NODES} symbols, so some connections are left out. Start again from another symbol to see them.`);
    if (graph.fileOverviewTruncated) list.push(`Incomplete: only the ${formatCount(graph.nodes.length)} files with the most symbols are drawn. This project has more.`);
    const count = graph.nodes.length > 0 ? h('p', { className: 'muted' }, `${formatCount(graph.nodes.length)} ${mode === 'files' ? 'files' : 'symbols'}, ${formatCount(graph.edges.length)} relations drawn`) : null;
    replace(notices, list.map((text) => h('p', { className: 'notice' }, text)), count);
  }

  function renderDetails() {
    replace(details, detailsPanel({ graph, mode, selectedId, signature: signatures.get(selectedId), onSelect: select, onRestart: startFrom }));
  }

  async function loadSignature(node) {
    if (mode !== 'symbols' || signatures.has(node.id)) return;
    let found = null;
    try {
      const data = await ctx.api.runTool('find_symbol', { name: node.name, matchMode: 'exact', filePath: node.filePath, topK: 50 });
      const result = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      const match = (result?.symbols ?? []).find((s) => s.id === node.id);
      if (match) found = { signature: match.signature ?? '', docComment: match.docComment ?? '' };
    } catch {
      // The panel then says the signature is not available; the graph itself still works.
    }
    signatures.set(node.id, found);
    if (alive && selectedId === node.id) renderDetails();
  }

  async function expand(id) {
    try {
      const payload = await ctx.api.neighborhood({ symbolId: id, depth: 1, limit: NEIGHBOR_LIMIT });
      if (!alive || mode !== 'symbols' || !graph.nodes.some((n) => n.id === id)) return;
      graph = mergeNeighborhood(graph, payload);
      redraw(id);
    } catch (err) {
      if (!alive || ctx.blocked(err)) return;
      notices.prepend(errorState(describeError(err), () => expand(id)));
    }
  }

  /** Select a node; in symbol mode a node that was not expanded yet also loads its neighbors. */
  function select(id) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    selectedId = id;
    canvas.draw(graph, positions, sizeFor(graph.nodes.length), selectedId);
    renderDetails();
    if (mode !== 'symbols') return;
    loadSignature(node);
    if (!graph.expanded.includes(id)) expand(id);
  }

  /** Throw the drawing away and start from one symbol. */
  async function startFrom(symbolId) {
    mode = 'symbols';
    syncMode();
    graph = emptyGraph();
    positions = new Map();
    selectedId = symbolId;
    replace(stage, loadingState('the neighborhood'));
    replace(notices);
    replace(details);
    try {
      const payload = await ctx.api.neighborhood({ symbolId, depth: 1, limit: NEIGHBOR_LIMIT });
      if (!alive) return;
      graph = mergeNeighborhood(emptyGraph(), payload);
      replace(stage, canvas.element, legend());
      redraw();
      if (payload.center) loadSignature(payload.center);
    } catch (err) {
      if (!alive || ctx.blocked(err)) return;
      replace(stage, errorState(describeError(err), () => startFrom(symbolId)));
    }
  }

  async function loadFiles() {
    graph = emptyGraph();
    positions = new Map();
    selectedId = null;
    replace(stage, loadingState('the file graph'));
    replace(notices);
    replace(details);
    try {
      const payload = await ctx.api.files({ limit: FILE_LIMIT });
      if (!alive || mode !== 'files') return;
      graph = fileGraphFromPayload(payload);
      if (graph.nodes.length === 0) {
        replace(stage, emptyState('No files in the index', 'The file graph appears once the project is indexed.'));
        return;
      }
      replace(stage, canvas.element, legend());
      redraw();
    } catch (err) {
      if (!alive || ctx.blocked(err)) return;
      replace(stage, errorState(describeError(err), loadFiles));
    }
  }

  function legend() {
    const line = (cls, text) => h('li', {}, h('span', { className: `legend-line ${cls}` }), text);
    const shapeKey = (cls, text) => h('li', {}, h('span', { className: `legend-shape ${cls}` }), text);
    return h(
      'ul',
      { className: 'legend graph-legend', 'aria-label': 'Legend' },
      mode === 'files'
        ? [line('line-solid', 'uses (imports or calls); thicker means more'), shapeKey('shape-square', 'file; larger means more symbols')]
        : [
            line('line-solid', 'calls'),
            line('line-dashed', 'imports'),
            line('line-dotted', 'extends or implements'),
            shapeKey('shape-circle', 'function or method'),
            shapeKey('shape-square', 'class, interface or type'),
            shapeKey('shape-triangle', 'variable or constant'),
            shapeKey('shape-ring', 'neighbors loaded'),
          ],
    );
  }

  async function search() {
    const q = searchInput.value.trim();
    const run = ++searchRun;
    if (q === '') {
      replace(results);
      searchState.textContent = '';
      return;
    }
    searchState.textContent = 'Searching…';
    try {
      const data = await ctx.api.graphSearch({ q, kind: kindSelect.value, limit: 30 });
      if (!alive || run !== searchRun) return;
      searchState.textContent = data.symbols.length === 0 ? `No symbol matches “${q}”. Check the spelling or choose another kind.` : `${data.symbols.length} ${data.symbols.length === 1 ? 'match' : 'matches'}${data.symbols.length === 30 ? ' (first 30)' : ''}. Choose one to draw it.`;
      replace(
        results,
        data.symbols.map((symbol) =>
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', className: 'result', onclick: () => choose(symbol) },
              h('span', { className: 'result-name code' }, symbol.name),
              h('span', { className: 'muted' }, ` ${symbol.kind}${symbol.isExported ? ', exported' : ''} `),
              h('span', { className: 'muted code' }, `${symbol.filePath}:${symbol.startLine}`),
            ),
          ),
        ),
      );
    } catch (err) {
      if (!alive || run !== searchRun || ctx.blocked(err)) return;
      searchState.textContent = '';
      replace(results, h('li', {}, errorState(describeError(err), search)));
    }
  }

  /** Draw a search result and fold the result list away so the drawing has the room. */
  function choose(symbol) {
    searchRun++;
    replace(results);
    searchState.textContent = `Drawing ${symbol.name}. Type again to find another symbol.`;
    startFrom(symbol.id);
  }

  function syncMode() {
    modeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    searchPanel.hidden = mode !== 'symbols';
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    syncMode();
    if (mode === 'files') loadFiles();
    else showStart();
  }

  function showStart() {
    graph = emptyGraph();
    positions = new Map();
    selectedId = null;
    replace(notices);
    replace(details);
    replace(stage, emptyState('Nothing drawn yet', 'Find a symbol above and choose it. Its callers, callees and other relations are drawn around it; select any node to load its neighbors too.'));
  }

  replace(
    container,
    h(
      'div',
      { className: 'page-head' },
      h('div', {}, h('h1', {}, 'Graph'), h('p', {}, 'How symbols and files of the indexed project relate.')),
      h('div', { className: 'segmented', role: 'group', 'aria-label': 'What to draw' }, modeButtons),
    ),
    h('div', { className: 'graph-layout' }, h('div', { className: 'graph-main' }, searchPanel, notices, stage), details),
  );
  syncMode();
  if (mode === 'files') loadFiles();
  else if (ctx.params.symbol) startFrom(ctx.params.symbol);
  else showStart();

  return () => {
    alive = false;
  };
}
