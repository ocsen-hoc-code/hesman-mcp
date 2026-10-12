// SVG charts for the metrics view, drawn at the pixel width they are given. Coordinates come from lib/chart-scale.js; every mark has a
// <title> so values can be read on hover, and the view offers the same numbers as a table.

import { s } from './dom.js';
import { niceMax, scaleSeries, ticks } from './lib/chart-scale.js';

const HEIGHT = 170;
const PAD = { left: 44, right: 8, top: 10, bottom: 22 };
const inner = (width) => width - PAD.left - PAD.right;
const innerHeight = HEIGHT - PAD.top - PAD.bottom;

function frame(width, label, max, formatTick, xLabels) {
  const svg = s('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, class: 'chart', role: 'img', 'aria-label': label });
  for (const tick of ticks(max, 2)) {
    const y = PAD.top + innerHeight - (innerHeight * tick) / max;
    svg.append(
      s('line', { x1: PAD.left, x2: width - PAD.right, y1: y, y2: y, class: tick === 0 ? 'chart-axis' : 'chart-grid' }),
      s('text', { x: PAD.left - 6, y: y + 4, class: 'chart-label', 'text-anchor': 'end' }, formatTick(tick)),
    );
  }
  xLabels.forEach(({ x, text, anchor }) => svg.append(s('text', { x: PAD.left + x, y: HEIGHT - 5, class: 'chart-label', 'text-anchor': anchor }, text)));
  return svg;
}

const edgeLabels = (points, innerWidth) =>
  points.length === 0
    ? []
    : [
        { x: 0, text: points[0].label, anchor: 'start' },
        { x: innerWidth, text: points[points.length - 1].label, anchor: 'end' },
      ];

/** Bars per bucket; the failed part of each bar is drawn in the error colour on top of it. */
export function callsChart(points, label, width = 720) {
  const innerWidth = inner(width);
  const max = niceMax(Math.max(1, ...points.map((p) => p.calls)));
  const svg = frame(width, label, max, String, edgeLabels(points, innerWidth));
  const slot = innerWidth / Math.max(1, points.length);
  const barWidth = Math.max(1, slot - 2);
  points.forEach((p, i) => {
    const x = PAD.left + i * slot + 1;
    const height = (innerHeight * p.calls) / max;
    const errorHeight = (innerHeight * p.errors) / max;
    const title = `${p.label}: ${p.calls} calls, ${p.errors} failed`;
    if (p.calls > 0) svg.append(s('rect', { x, y: PAD.top + innerHeight - height, width: barWidth, height, class: 'chart-bar' }, s('title', {}, title)));
    if (p.errors > 0) svg.append(s('rect', { x, y: PAD.top + innerHeight - errorHeight, width: barWidth, height: errorHeight, class: 'chart-bar-error' }, s('title', {}, title)));
  });
  return svg;
}

/** A line over the buckets that had calls; empty buckets break the line instead of dropping to zero. */
export function latencyChart(points, label, formatValue, width = 720) {
  const innerWidth = inner(width);
  const max = niceMax(Math.max(1, ...points.map((p) => p.avgMs)));
  const svg = frame(width, label, max, (v) => formatValue(v), edgeLabels(points, innerWidth));
  const slot = innerWidth / Math.max(1, points.length);
  const scaled = scaleSeries(points.map((p) => p.avgMs), { width: innerWidth - slot, height: innerHeight, max });
  let path = '';
  let pen = false;
  scaled.forEach((point, i) => {
    if (points[i].calls === 0) {
      pen = false;
      return;
    }
    const x = PAD.left + slot / 2 + point.x;
    const y = PAD.top + point.y;
    path += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
    svg.append(s('circle', { cx: x, cy: y, r: 2.5, class: 'chart-dot' }, s('title', {}, `${points[i].label}: ${formatValue(point.value)} average`)));
  });
  if (path) svg.prepend(s('path', { d: path, class: 'chart-line' }));
  return svg;
}
