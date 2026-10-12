/* global document, CSS */
// SVG drawing of a graph from lib/graph-model.js with positions from lib/graph-layout.js.
// Line style carries the relation kind (solid = calls, dashed = imports, dotted = inheritance),
// node shape carries the symbol kind. Pan by dragging, zoom with the wheel or the buttons.

import { h, s } from './dom.js';
import { degrees } from './lib/graph-model.js';

/** With more nodes than this, only the important labels are always drawn; the rest show on hover or focus. */
const ALL_LABELS_UP_TO = 45;
const SQUARE_KINDS = new Set(['class', 'interface', 'type', 'enum', 'namespace', 'file']);
const TRIANGLE_KINDS = new Set(['variable', 'constant']);
const EDGE_CLASS = { calls: 'edge-calls', imports: 'edge-imports', import: 'edge-imports', extends: 'edge-inherits', implements: 'edge-inherits', file: 'edge-file' };

function shape(node, r) {
  if (SQUARE_KINDS.has(node.kind)) return s('rect', { x: -r, y: -r, width: 2 * r, height: 2 * r, class: 'node-shape' });
  if (TRIANGLE_KINDS.has(node.kind)) return s('path', { d: `M0 ${-r - 1}L${r + 1} ${r}L${-r - 1} ${r}Z`, class: 'node-shape' });
  return s('circle', { r, class: 'node-shape' });
}

const describe = (node) =>
  node.kind === 'file' ? `File ${node.filePath}, ${node.symbols ?? 0} symbols` : `${node.name}, ${node.kind}, ${node.filePath} line ${node.startLine}`;

/**
 * @param onSelect called with a node id when a node is clicked or activated with Enter or Space
 * @returns `{ element, draw(graph, positions, size, selectedId), fit() }`
 */
export function createGraphCanvas({ onSelect }) {
  const edgeLayer = s('g', {});
  const nodeLayer = s('g', {});
  const svg = s(
    'svg',
    { class: 'graph-svg', role: 'group', 'aria-label': 'Graph drawing. Tab moves between nodes; Enter selects one.' },
    s('defs', {}, s('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0 1L9 5L0 9Z', class: 'edge-arrow' }))),
    edgeLayer,
    nodeLayer,
  );
  let full = { x: 0, y: 0, w: 1000, h: 640 };
  let view = { ...full };

  const applyView = () => svg.setAttribute('viewBox', `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`);

  function zoom(factor, cx = view.x + view.w / 2, cy = view.y + view.h / 2) {
    const w = Math.min(full.w * 1.5, Math.max(full.w / 12, view.w * factor));
    const ratio = w / view.w;
    view = { x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio, w, h: view.h * ratio };
    applyView();
  }

  function fit() {
    view = { ...full };
    applyView();
  }

  // Drag the background to pan.
  let drag = null;
  svg.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.node') || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, view: { ...view } };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const scale = view.w / svg.clientWidth;
    view = { ...view, x: drag.view.x - (event.clientX - drag.x) * scale, y: drag.view.y - (event.clientY - drag.y) * scale };
    applyView();
  });
  const endDrag = () => (drag = null);
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const box = svg.getBoundingClientRect();
      const cx = view.x + ((event.clientX - box.left) / box.width) * view.w;
      const cy = view.y + ((event.clientY - box.top) / box.height) * view.h;
      zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, cx, cy);
    },
    { passive: false },
  );

  const button = (label, onclick) => h('button', { type: 'button', className: 'btn', onclick }, label);
  const controls = h(
    'div',
    { className: 'graph-controls', role: 'group', 'aria-label': 'Zoom' },
    button('Zoom in', () => zoom(1 / 1.3)),
    button('Zoom out', () => zoom(1.3)),
    button('Fit', fit),
  );
  const element = h('div', { className: 'graph-canvas' }, svg, controls);

  function draw(graph, positions, size, selectedId) {
    const hadFocus = svg.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    const sizeChanged = size.width !== full.w || size.height !== full.h;
    full = { x: 0, y: 0, w: size.width, h: size.height };
    if (sizeChanged) view = { ...full };
    applyView();

    const degree = degrees(graph);
    const neighbors = new Set();
    for (const edge of graph.edges) {
      if (edge.from === selectedId) neighbors.add(edge.to);
      if (edge.to === selectedId) neighbors.add(edge.from);
    }
    const labelAll = graph.nodes.length <= ALL_LABELS_UP_TO;
    const busiest = new Set([...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id));
    const radius = (node) => (node.kind === 'file' ? 5 + Math.min(7, Math.sqrt(node.symbols ?? 1)) : 6 + Math.min(5, Math.sqrt(degree.get(node.id) ?? 0)));
    const radii = new Map(graph.nodes.map((n) => [n.id, radius(n)]));

    edgeLayer.replaceChildren(
      ...graph.edges.flatMap((edge) => {
        const a = positions.get(edge.from);
        const b = positions.get(edge.to);
        if (!a || !b || edge.from === edge.to) return [];
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / length;
        const uy = (b.y - a.y) / length;
        const ra = radii.get(edge.from) + 1;
        const rb = radii.get(edge.to) + 3;
        const active = edge.from === selectedId || edge.to === selectedId;
        return s('line', {
          x1: a.x + ux * ra,
          y1: a.y + uy * ra,
          x2: b.x - ux * rb,
          y2: b.y - uy * rb,
          class: `edge ${EDGE_CLASS[edge.kind] ?? 'edge-other'}${active ? ' is-active' : ''}`,
          'stroke-width': edge.kind === 'file' ? Math.min(4, 1 + Math.log2(edge.count ?? 1)) : undefined,
          'marker-end': 'url(#arrow)',
        });
      }),
    );

    nodeLayer.replaceChildren(
      ...graph.nodes.map((node) => {
        const at = positions.get(node.id) ?? { x: size.width / 2, y: size.height / 2 };
        const r = radii.get(node.id);
        const labelled = labelAll || node.id === graph.rootId || node.id === selectedId || neighbors.has(node.id) || busiest.has(node.id);
        const classes = ['node', `kind-${SQUARE_KINDS.has(node.kind) ? 'type' : TRIANGLE_KINDS.has(node.kind) ? 'value' : 'callable'}`];
        if (node.id === graph.rootId) classes.push('is-root');
        if (node.id === selectedId) classes.push('is-selected');
        if (neighbors.has(node.id)) classes.push('is-neighbor');
        if (graph.expanded.includes(node.id)) classes.push('is-expanded');
        if (labelled) classes.push('has-label');
        const leftSide = at.x > size.width * 0.8;
        const group = s(
          'g',
          { class: classes.join(' '), transform: `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`, tabindex: 0, role: 'button', 'aria-label': describe(node), 'aria-pressed': String(node.id === selectedId), 'data-id': node.id },
          graph.expanded.includes(node.id) ? s('circle', { r: r + 4, class: 'node-ring' }) : null,
          shape(node, r),
          s('text', { x: leftSide ? -r - 5 : r + 5, y: 4, 'text-anchor': leftSide ? 'end' : 'start', class: 'node-label' }, node.name),
          s('title', {}, describe(node)),
        );
        group.addEventListener('click', () => onSelect(node.id));
        group.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onSelect(node.id);
        });
        return group;
      }),
    );
    // Selected and labelled nodes go last so their labels are drawn over the others.
    for (const top of nodeLayer.querySelectorAll('.is-neighbor, .is-selected')) nodeLayer.append(top);
    if (hadFocus) nodeLayer.querySelector(`[data-id="${CSS.escape(hadFocus)}"]`)?.focus({ preventScroll: true });
  }

  return { element, draw, fit };
}
