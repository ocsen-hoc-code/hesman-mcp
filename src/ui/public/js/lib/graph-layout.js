// A small deterministic force-directed layout (Fruchterman-Reingold style): every pair of nodes
// repels, linked nodes attract, a weak pull keeps everything near the middle. O(n^2) per step,
// which is fine for the few hundred nodes the explorer allows. No DOM access, no randomness.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Deterministic start position: a sunflower spiral around the center. */
function seed(index, count, cx, cy, radius) {
  const r = radius * Math.sqrt((index + 0.5) / count);
  const a = index * GOLDEN_ANGLE;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param nodes `[{ id }]`
 * @param edges `[{ from, to }]`
 * @param options `{ width, height, positions?: Map<id,{x,y}>, fixedId?, iterations?, padding? }`
 *   `positions` are starting points for nodes laid out before, so an expanded graph does not jump.
 * @returns Map<id, { x, y }>
 */
export function layoutGraph(nodes, edges, options) {
  const { width, height, positions, fixedId } = options;
  const padding = options.padding ?? 24;
  const cx = width / 2;
  const cy = height / 2;
  const n = nodes.length;
  const result = new Map();
  if (n === 0) return result;

  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const spread = Math.min(width, height) / 2 - padding;
  nodes.forEach((node, i) => {
    const known = positions?.get(node.id);
    const start = known ?? seed(i, n, cx, cy, spread);
    xs[i] = start.x;
    ys[i] = start.y;
  });
  const fixed = fixedId !== undefined && index.has(fixedId) ? index.get(fixedId) : -1;
  if (fixed >= 0 || n === 1) {
    const i = Math.max(fixed, 0);
    xs[i] = cx;
    ys[i] = cy;
  }

  const links = edges
    .map((e) => [index.get(e.from), index.get(e.to)])
    .filter(([a, b]) => a !== undefined && b !== undefined && a !== b);

  // Ideal distance between neighbors, from the free area per node.
  const k = Math.sqrt(((width - 2 * padding) * (height - 2 * padding)) / n) * 0.9;
  const iterations = options.iterations ?? 260;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  for (let step = 0; step < iterations && n > 1; step++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = xs[i] - xs[j];
        let vy = ys[i] - ys[j];
        let d2 = vx * vx + vy * vy;
        if (d2 < 0.01) {
          // Coincident nodes: push apart along a direction derived from their indices.
          vx = Math.cos(i * GOLDEN_ANGLE + j);
          vy = Math.sin(i * GOLDEN_ANGLE + j);
          d2 = 0.01;
        }
        const force = (k * k) / d2;
        dx[i] += vx * force;
        dy[i] += vy * force;
        dx[j] -= vx * force;
        dy[j] -= vy * force;
      }
    }
    for (const [a, b] of links) {
      const vx = xs[a] - xs[b];
      const vy = ys[a] - ys[b];
      const d = Math.sqrt(vx * vx + vy * vy) || 0.01;
      const force = d / k;
      dx[a] -= vx * force;
      dy[a] -= vy * force;
      dx[b] += vx * force;
      dy[b] += vy * force;
    }
    // Cooling: big moves first, fine adjustment at the end.
    const temperature = (Math.min(width, height) / 8) * (1 - step / iterations) + 0.5;
    for (let i = 0; i < n; i++) {
      if (i === fixed) continue;
      dx[i] += (cx - xs[i]) * 0.02;
      dy[i] += (cy - ys[i]) * 0.02;
      const length = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const move = Math.min(length, temperature);
      xs[i] = clamp(xs[i] + (dx[i] / length) * move, padding, width - padding);
      ys[i] = clamp(ys[i] + (dy[i] / length) * move, padding, height - padding);
    }
  }

  // Collision pass: leaves of one hub end up almost on top of each other, so push apart
  // every pair that is closer than `minDistance` (room for a node mark and part of its label).
  const minDistance = options.minDistance ?? 26;
  for (let pass = 0; pass < 40 && n > 1; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = xs[i] - xs[j];
        let vy = ys[i] - ys[j];
        let d = Math.sqrt(vx * vx + vy * vy);
        if (d >= minDistance) continue;
        if (d < 0.01) {
          vx = Math.cos(i * GOLDEN_ANGLE + j);
          vy = Math.sin(i * GOLDEN_ANGLE + j);
          d = 1;
        }
        const push = (minDistance - d) / 2 + 0.5;
        const shareI = i === fixed ? 0 : j === fixed ? 2 : 1;
        xs[i] = clamp(xs[i] + (vx / d) * push * shareI, padding, width - padding);
        ys[i] = clamp(ys[i] + (vy / d) * push * shareI, padding, height - padding);
        xs[j] = clamp(xs[j] - (vx / d) * push * (2 - shareI), padding, width - padding);
        ys[j] = clamp(ys[j] - (vy / d) * push * (2 - shareI), padding, height - padding);
        moved = true;
      }
    }
    if (!moved) break;
  }

  nodes.forEach((node, i) => result.set(node.id, { x: xs[i], y: ys[i] }));
  return result;
}
