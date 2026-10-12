// Details panel of the graph explorer: what the selected node is, what it is connected to,
// and links that open the playground with a tool prefilled.

import { h } from '../dom.js';
import { formatCount } from '../lib/format.js';
import { connectionsOf } from '../lib/graph-model.js';
import { playgroundRoute } from '../lib/router.js';

const fact = (term, ...value) => [h('dt', {}, term), h('dd', {}, value)];

function nodeList(title, items, onSelect, describe) {
  if (items.length === 0) return null;
  return h(
    'section',
    {},
    h('h3', {}, `${title} (${formatCount(items.length)})`),
    h(
      'ul',
      { className: 'node-list' },
      items.map((item) =>
        h(
          'li',
          {},
          h('button', { type: 'button', className: 'result', onclick: () => onSelect(item.node.id) }, h('span', { className: 'code' }, item.node.name), describe ? h('span', { className: 'muted' }, ` ${describe(item)}`) : null),
        ),
      ),
    ),
  );
}

function signatureFact(signature) {
  if (signature === undefined) return fact('Signature', h('span', { className: 'muted' }, 'Loading…'));
  if (signature === null || !signature.signature) return fact('Signature', h('span', { className: 'muted' }, 'Not available'));
  return [fact('Signature', h('code', { className: 'signature' }, signature.signature)), signature.docComment ? fact('Comment', h('span', { className: 'doc-comment' }, signature.docComment)) : null];
}

function symbolDetails({ graph, node, signature, onSelect, onRestart }) {
  const links = connectionsOf(graph, node.id);
  const truncated = graph.truncated.includes(node.id);
  return [
    h('h2', { className: 'code' }, node.name),
    h(
      'dl',
      { className: 'facts' },
      fact('Kind', node.kind),
      fact('Location', h('code', {}, `${node.filePath}:${node.startLine}`)),
      fact('Language', node.language ?? ''),
      signatureFact(signature),
    ),
    truncated ? h('p', { className: 'notice' }, 'This symbol has more connections than are drawn. The playground links below return the full lists.') : null,
    h(
      'ul',
      { className: 'action-list' },
      h('li', {}, h('a', { href: playgroundRoute('get_callers', { symbolId: node.id }) }, 'List callers in the playground')),
      h('li', {}, h('a', { href: playgroundRoute('get_callees', { symbolId: node.id }) }, 'List callees in the playground')),
      h('li', {}, h('a', { href: playgroundRoute('get_context', { filePath: node.filePath, startLine: node.startLine }) }, 'Read the source in the playground')),
      node.id !== graph.rootId ? h('li', {}, h('button', { type: 'button', className: 'btn', onclick: () => onRestart(node.id) }, 'Start a new drawing here')) : null,
    ),
    nodeList('Called by', links.callers, onSelect, (item) => (item.edge.line ? `line ${item.edge.line}` : '')),
    nodeList('Calls', links.callees, onSelect, (item) => (item.edge.line ? `line ${item.edge.line}` : '')),
    nodeList('Other relations', links.others, onSelect, (item) => `${item.kind}, ${item.direction === 'out' ? 'outgoing' : 'incoming'}`),
    links.callers.length + links.callees.length + links.others.length === 0 ? h('p', { className: 'muted' }, graph.expanded.includes(node.id) ? 'No relations are indexed for this symbol.' : 'Loading its neighbors…') : null,
  ];
}

function fileDetails({ graph, node, onSelect }) {
  const links = connectionsOf(graph, node.id).others;
  const uses = links.filter((l) => l.direction === 'out');
  const usedBy = links.filter((l) => l.direction === 'in');
  const count = (item) => `${formatCount(item.edge.count)} ${item.edge.count === 1 ? 'link' : 'links'}`;
  return [
    h('h2', { className: 'code' }, node.name),
    h('dl', { className: 'facts' }, fact('Kind', 'file'), fact('Path', h('code', {}, node.filePath)), fact('Language', node.language ?? ''), fact('Symbols', formatCount(node.symbols))),
    h(
      'ul',
      { className: 'action-list' },
      h('li', {}, h('a', { href: playgroundRoute('get_file_structure', { filePath: node.filePath }) }, 'List its symbols in the playground')),
      h('li', {}, h('a', { href: playgroundRoute('list_dependencies', { filePath: node.filePath, direction: 'both' }) }, 'List its dependencies in the playground')),
    ),
    nodeList('Uses', uses, onSelect, count),
    nodeList('Used by', usedBy, onSelect, count),
    links.length === 0 ? h('p', { className: 'muted' }, 'No links to other drawn files.') : null,
  ];
}

export function detailsPanel({ graph, mode, selectedId, signature, onSelect, onRestart }) {
  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) return graph.nodes.length === 0 ? null : h('p', { className: 'muted' }, 'Select a node to see what it is and what it is connected to.');
  return mode === 'files' ? fileDetails({ graph, node, onSelect }) : symbolDetails({ graph, node, signature, onSelect, onRestart });
}
