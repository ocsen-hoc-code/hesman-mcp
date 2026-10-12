// Graph state for the explorer: immutable merge of neighborhood responses, deduplication,
// and the queries the details panel needs. No DOM access.

/** Above this the drawing stops being readable; further nodes are refused and the UI says so. */
export const MAX_GRAPH_NODES = 300;

export function emptyGraph() {
  return { nodes: [], edges: [], rootId: null, expanded: [], truncated: [], capped: false, fileOverviewTruncated: false };
}

const edgeKey = (e) => `${e.from}|${e.to}|${e.kind}`;
const isNode = (n) => n !== null && typeof n === 'object' && typeof n.id === 'string' && n.id !== '';

/**
 * Merge one `GET /api/graph/neighborhood` response into a graph and return the new graph.
 * Nodes are unique by id, edges by (from, to, kind); repeated edges are counted.
 */
export function mergeNeighborhood(graph, payload, options = {}) {
  const maxNodes = options.maxNodes ?? MAX_GRAPH_NODES;
  const center = isNode(payload?.center) ? payload.center : null;
  const incomingNodes = Array.isArray(payload?.nodes) ? payload.nodes.filter(isNode) : [];
  const incomingEdges = Array.isArray(payload?.edges) ? payload.edges : [];

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  let capped = graph.capped;
  for (const node of center ? [center, ...incomingNodes] : incomingNodes) {
    if (nodes.has(node.id)) nodes.set(node.id, { ...nodes.get(node.id), ...node });
    else if (nodes.size < maxNodes) nodes.set(node.id, { ...node });
    else capped = true;
  }

  const edges = new Map(graph.edges.map((e) => [edgeKey(e), e]));
  // Counts restart for the pairs this response reports, so merging the same response twice is stable.
  const seenNow = new Map();
  for (const raw of incomingEdges) {
    if (!raw || !nodes.has(raw.from) || !nodes.has(raw.to)) continue;
    const edge = { from: raw.from, to: raw.to, kind: String(raw.kind ?? 'related'), line: raw.line ?? null };
    const key = edgeKey(edge);
    const count = (seenNow.get(key) ?? 0) + 1;
    seenNow.set(key, count);
    const known = edges.get(key);
    if (!known) edges.set(key, { ...edge, count });
    else if (count > known.count) edges.set(key, { ...known, count });
  }

  const centerId = center && nodes.has(center.id) ? center.id : null;
  const without = (list) => list.filter((id) => id !== centerId);
  return {
    ...graph,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    rootId: graph.rootId ?? centerId,
    expanded: centerId ? [...without(graph.expanded), centerId] : graph.expanded,
    truncated: centerId && payload.truncated === true ? [...without(graph.truncated), centerId] : without(graph.truncated),
    capped,
  };
}

/** What is connected to a node, split the way the details panel shows it. */
export function connectionsOf(graph, id) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = { callers: [], callees: [], others: [] };
  if (!byId.has(id)) return out;
  for (const edge of graph.edges) {
    if (edge.from !== id && edge.to !== id) continue;
    if (edge.from === edge.to) continue;
    const outgoing = edge.from === id;
    const node = byId.get(outgoing ? edge.to : edge.from);
    if (edge.kind === 'calls') (outgoing ? out.callees : out.callers).push({ node, edge });
    else out.others.push({ node, edge, kind: edge.kind, direction: outgoing ? 'out' : 'in' });
  }
  return out;
}

/** Number of edges touching each node id. */
export function degrees(graph) {
  const map = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const edge of graph.edges) {
    map.set(edge.from, (map.get(edge.from) ?? 0) + 1);
    map.set(edge.to, (map.get(edge.to) ?? 0) + 1);
  }
  return map;
}

/** Turn a `GET /api/graph/files` response into the same graph shape (kind `file`). */
export function fileGraphFromPayload(payload) {
  const rows = Array.isArray(payload?.nodes) ? payload.nodes.filter(isNode) : [];
  const nodes = rows.map((row) => ({
    id: row.id,
    name: row.id.split('/').pop(),
    kind: 'file',
    filePath: row.id,
    language: row.language,
    symbols: row.symbols,
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(payload?.edges) ? payload.edges : [])
    .filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => ({ from: e.from, to: e.to, kind: 'file', count: e.count ?? 1 }));
  return { ...emptyGraph(), nodes, edges, fileOverviewTruncated: payload?.truncated === true };
}
