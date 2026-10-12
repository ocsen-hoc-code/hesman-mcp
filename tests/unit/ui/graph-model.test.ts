import { describe, expect, it } from 'vitest';
import {
  connectionsOf,
  emptyGraph,
  fileGraphFromPayload,
  mergeNeighborhood,
} from '../../../src/ui/public/js/lib/graph-model.js';
import { layoutGraph } from '../../../src/ui/public/js/lib/graph-layout.js';

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.toUpperCase(),
  kind: 'function',
  filePath: `src/${id}.ts`,
  startLine: 1,
  language: 'typescript',
  ...extra,
});

describe('mergeNeighborhood', () => {
  it('adds the center, its nodes and edges', () => {
    const g = mergeNeighborhood(emptyGraph(), {
      center: node('a'),
      nodes: [node('b'), node('c')],
      edges: [
        { from: 'b', to: 'a', kind: 'calls', line: 4 },
        { from: 'a', to: 'c', kind: 'calls', line: 9 },
      ],
      truncated: false,
    });
    expect(g.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b', 'c']);
    expect(g.edges).toHaveLength(2);
    expect(g.rootId).toBe('a');
    expect(g.expanded).toEqual(['a']);
    expect(g.truncated).toEqual([]);
  });

  it('does not mutate the graph it is given', () => {
    const before = emptyGraph();
    mergeNeighborhood(before, { center: node('a'), nodes: [], edges: [], truncated: false });
    expect(before.nodes).toEqual([]);
  });

  it('dedupes nodes by id and edges by from, to and kind', () => {
    const first = mergeNeighborhood(emptyGraph(), {
      center: node('a'),
      nodes: [node('a'), node('b')],
      edges: [{ from: 'a', to: 'b', kind: 'calls', line: 3 }],
      truncated: false,
    });
    const second = mergeNeighborhood(first, {
      center: node('b'),
      nodes: [node('a'), node('d')],
      edges: [
        { from: 'a', to: 'b', kind: 'calls', line: 7 },
        { from: 'a', to: 'b', kind: 'imports', line: 1 },
        { from: 'b', to: 'd', kind: 'calls', line: 2 },
      ],
      truncated: false,
    });
    expect(second.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b', 'd']);
    expect(second.edges.map((e: { from: string; to: string; kind: string }) => `${e.from}>${e.to}:${e.kind}`)).toEqual([
      'a>b:calls',
      'a>b:imports',
      'b>d:calls',
    ]);
    // The first root stays the root; both centers are marked as expanded.
    expect(second.rootId).toBe('a');
    expect(second.expanded).toEqual(['a', 'b']);
  });

  it('counts repeated edges and keeps the first line', () => {
    const g = mergeNeighborhood(emptyGraph(), {
      center: node('a'),
      nodes: [node('b')],
      edges: [
        { from: 'a', to: 'b', kind: 'calls', line: 3 },
        { from: 'a', to: 'b', kind: 'calls', line: 8 },
      ],
      truncated: false,
    });
    expect(g.edges).toEqual([{ from: 'a', to: 'b', kind: 'calls', line: 3, count: 2 }]);
  });

  it('drops edges whose endpoint is unknown', () => {
    const g = mergeNeighborhood(emptyGraph(), {
      center: node('a'),
      nodes: [],
      edges: [{ from: 'a', to: 'ghost', kind: 'calls', line: 3 }],
      truncated: false,
    });
    expect(g.edges).toEqual([]);
  });

  it('remembers which centers came back truncated', () => {
    const g = mergeNeighborhood(emptyGraph(), { center: node('a'), nodes: [], edges: [], truncated: true });
    expect(g.truncated).toEqual(['a']);
    const again = mergeNeighborhood(g, { center: node('a'), nodes: [], edges: [], truncated: false });
    expect(again.truncated).toEqual([]);
  });

  it('stops adding nodes at maxNodes and says so', () => {
    const g = mergeNeighborhood(
      emptyGraph(),
      {
        center: node('a'),
        nodes: [node('b'), node('c'), node('d')],
        edges: [
          { from: 'a', to: 'b', kind: 'calls', line: 1 },
          { from: 'a', to: 'd', kind: 'calls', line: 1 },
        ],
        truncated: false,
      },
      { maxNodes: 2 },
    );
    expect(g.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b']);
    expect(g.edges).toHaveLength(1);
    expect(g.capped).toBe(true);
  });

  it('tolerates a malformed payload', () => {
    const g = mergeNeighborhood(emptyGraph(), { center: null, nodes: null, edges: 'x' });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe('connectionsOf', () => {
  const g = mergeNeighborhood(emptyGraph(), {
    center: node('a'),
    nodes: [node('b'), node('c'), node('d')],
    edges: [
      { from: 'b', to: 'a', kind: 'calls', line: 4 },
      { from: 'a', to: 'c', kind: 'calls', line: 9 },
      { from: 'a', to: 'd', kind: 'extends', line: 1 },
      { from: 'c', to: 'a', kind: 'imports', line: 2 },
    ],
    truncated: false,
  });

  it('splits callers, callees and other relations', () => {
    const c = connectionsOf(g, 'a');
    expect(c.callers.map((x: { node: { id: string } }) => x.node.id)).toEqual(['b']);
    expect(c.callees.map((x: { node: { id: string } }) => x.node.id)).toEqual(['c']);
    expect(
      c.others.map((x: { node: { id: string }; kind: string; direction: string }) => [x.node.id, x.kind, x.direction]),
    ).toEqual([
      ['d', 'extends', 'out'],
      ['c', 'imports', 'in'],
    ]);
  });

  it('is empty for an unknown node', () => {
    expect(connectionsOf(g, 'nope')).toEqual({ callers: [], callees: [], others: [] });
  });
});

describe('fileGraphFromPayload', () => {
  it('turns file rows into graph nodes with a short name', () => {
    const g = fileGraphFromPayload({
      nodes: [
        { id: 'src/cart/cart.ts', language: 'typescript', symbols: 12 },
        { id: 'src/db.ts', language: 'typescript', symbols: 4 },
      ],
      edges: [
        { from: 'src/cart/cart.ts', to: 'src/db.ts', count: 3 },
        { from: 'src/cart/cart.ts', to: 'src/missing.ts', count: 1 },
        { from: 'src/db.ts', to: 'src/db.ts', count: 2 },
      ],
      truncated: true,
    });
    expect(g.nodes[0]).toEqual({
      id: 'src/cart/cart.ts',
      name: 'cart.ts',
      kind: 'file',
      filePath: 'src/cart/cart.ts',
      language: 'typescript',
      symbols: 12,
    });
    expect(g.edges).toEqual([{ from: 'src/cart/cart.ts', to: 'src/db.ts', kind: 'file', count: 3 }]);
    expect(g.fileOverviewTruncated).toBe(true);
  });
});

describe('layoutGraph', () => {
  const ids = Array.from({ length: 100 }, (_, i) => `n${i}`);
  const nodes = ids.map((id) => ({ id }));
  const edges = ids.slice(1).map((id, i) => ({ from: ids[Math.floor(i / 3)], to: id }));

  it('gives every node a finite position inside the area', () => {
    const pos = layoutGraph(nodes, edges, { width: 1200, height: 800 });
    expect(pos.size).toBe(100);
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1200);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(800);
    }
  });

  it('is deterministic', () => {
    const a = layoutGraph(nodes, edges, { width: 1200, height: 800 });
    const b = layoutGraph(nodes, edges, { width: 1200, height: 800 });
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('keeps 100 nodes apart', () => {
    const pos = [...layoutGraph(nodes, edges, { width: 1200, height: 800 }).values()];
    let min = Infinity;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        min = Math.min(min, Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y));
      }
    }
    expect(min).toBeGreaterThan(14);
  });

  it('puts linked nodes closer together than unlinked ones on average', () => {
    const pos = layoutGraph(nodes, edges, { width: 1200, height: 800 });
    const dist = (a: string, b: string) => Math.hypot(pos.get(a).x - pos.get(b).x, pos.get(a).y - pos.get(b).y);
    const linked = edges.reduce((sum, e) => sum + dist(e.from, e.to), 0) / edges.length;
    let total = 0;
    let count = 0;
    for (let i = 0; i < ids.length; i += 7) {
      for (let j = i + 1; j < ids.length; j += 5) {
        total += dist(ids[i], ids[j]);
        count++;
      }
    }
    expect(linked).toBeLessThan((total / count) * 0.6);
  });

  it('pins the fixed node at the center and starts from known positions', () => {
    const pos = layoutGraph(nodes.slice(0, 5), edges.slice(0, 4), { width: 600, height: 400, fixedId: 'n0' });
    expect(pos.get('n0')).toEqual({ x: 300, y: 200 });
  });

  it('handles an empty graph and a single node', () => {
    expect(layoutGraph([], [], { width: 100, height: 100 }).size).toBe(0);
    expect(layoutGraph([{ id: 'x' }], [], { width: 100, height: 100 }).get('x')).toEqual({ x: 50, y: 50 });
  });
});
