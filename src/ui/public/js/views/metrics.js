/* global ResizeObserver */
// Metrics: what the tools were asked, how long they took and how many tokens the answers cost.
// Data: GET /api/metrics?windowMinutes=, GET /api/calls?limit=&before=&tool=.

import { callsChart, latencyChart } from '../charts.js';
import { dataTable, emptyState, errorState, h, loadingState, mark, poll, replace } from '../dom.js';
import { describeError } from '../api.js';
import { DASH, formatClock, formatCount, formatDateTime, formatDuration, formatPercent, formatTokens, tokenSavings } from '../lib/format.js';

const WINDOWS = [
  [15, '15 min'],
  [60, '1 hour'],
  [360, '6 hours'],
  [1440, '24 hours'],
];
const PAGE = 50;

const figure = (term, value, note) => h('div', {}, h('dt', {}, term), h('dd', {}, value), note ? h('dd', { className: 'figure-note' }, note) : null);

/** Two bars on one scale: tokens before compression (light) and tokens returned (solid). */
function tokenBars(row, max) {
  const width = (n) => `width:${max > 0 ? Math.max(1, (100 * n) / max).toFixed(1) : 0}%`;
  return h(
    'div',
    { className: 'token-bars', title: `${formatCount(row.tokensOriginal)} before, ${formatCount(row.tokensReturned)} returned` },
    h('span', { className: 'token-bar token-bar-original', style: width(row.tokensOriginal) }),
    h('span', { className: 'token-bar token-bar-returned', style: width(row.tokensReturned) }),
  );
}

function summarySection(summary) {
  const saved = tokenSavings(summary.tokensOriginal, summary.tokensReturned);
  return h(
    'dl',
    { className: 'figures' },
    figure('Calls', formatCount(summary.calls)),
    figure('Failed', formatCount(summary.errors), summary.calls > 0 ? formatPercent(summary.errors / summary.calls) : null),
    figure('Median latency', summary.calls > 0 ? formatDuration(summary.p50Ms) : DASH),
    figure('95th percentile', summary.calls > 0 ? formatDuration(summary.p95Ms) : DASH),
    figure('Tokens before compression', formatTokens(summary.tokensOriginal)),
    figure('Tokens returned', formatTokens(summary.tokensReturned), saved.saved > 0 ? `${saved.label} fewer` : null),
  );
}

function byToolTable(byTool) {
  const max = Math.max(0, ...byTool.map((t) => t.tokensOriginal));
  return dataTable(
    'Metrics per tool',
    [
      { label: 'Tool', code: true, cell: (t) => t.tool },
      { label: 'Calls', num: true, cell: (t) => formatCount(t.calls) },
      { label: 'Failed', num: true, cell: (t) => formatCount(t.errors) },
      { label: 'Average', num: true, cell: (t) => formatDuration(t.avgMs) },
      { label: '95th pct.', num: true, cell: (t) => formatDuration(t.p95Ms) },
      { label: 'Tokens before', num: true, cell: (t) => formatTokens(t.tokensOriginal) },
      { label: 'Returned', num: true, cell: (t) => formatTokens(t.tokensReturned) },
      { label: 'Fewer', num: true, cell: (t) => tokenSavings(t.tokensOriginal, t.tokensReturned).label },
      { label: 'Before and returned', cell: (t) => tokenBars(t, max) },
    ],
    byTool,
  );
}

function callsTable(calls) {
  return dataTable(
    'Recent tool calls, newest first',
    [
      { label: 'Time', cell: (c) => h('time', { dateTime: String(c.time), title: formatDateTime(c.time) }, formatClock(c.time)) },
      { label: 'Tool', code: true, cell: (c) => c.tool },
      { label: 'Result', cell: (c) => (c.ok ? mark('ok', 'OK') : mark('error', c.errorCode || 'Failed')) },
      { label: 'Duration', num: true, cell: (c) => formatDuration(c.durationMs) },
      { label: 'Tokens before', num: true, cell: (c) => formatTokens(c.originalTokens) },
      { label: 'Returned', num: true, cell: (c) => formatTokens(c.compressedTokens) },
      { label: 'Arguments', code: true, cell: (c) => c.argsPreview || DASH },
    ],
    calls,
  );
}

export function mount(container, ctx) {
  let windowMinutes = 60;
  let toolFilter = '';
  let calls = [];
  let nextBefore = null;
  let lastMetrics = null;

  const summaryBox = h('div', {}, loadingState('metrics'));
  const chartBox = h('div', { className: 'chart-box' });
  const toolBox = h('div', {});
  const callsBox = h('div', {}, loadingState('recent calls'));
  const olderButton = h('button', { type: 'button', className: 'btn', hidden: true, onclick: () => loadOlder() }, 'Load older calls');
  const toolSelect = h('select', { id: 'calls-tool', onchange: () => setTool(toolSelect.value) }, h('option', { value: '' }, 'All tools'));
  const windowButtons = WINDOWS.map(([minutes, label]) =>
    h('button', { type: 'button', className: 'btn', 'aria-pressed': String(minutes === windowMinutes), onclick: () => setWindow(minutes) }, label),
  );

  function drawCharts() {
    if (!lastMetrics) return;
    const series = lastMetrics.series ?? [];
    if (series.every((p) => p.calls === 0)) {
      replace(chartBox, emptyState('No calls in this period', 'Charts appear once an agent uses a Hesman tool. Try a longer period, or run a tool in the playground.'));
      return;
    }
    const points = series.map((p) => ({ ...p, label: formatClock(p.t).slice(0, 5) }));
    const width = Math.max(280, Math.floor(chartBox.clientWidth) || 720);
    replace(
      chartBox,
      h('h3', {}, 'Calls over time ', h('span', { className: 'chart-key' }, h('span', { className: 'key key-calls' }), 'calls', h('span', { className: 'key key-errors' }), 'failed')),
      callsChart(points, 'Calls and failed calls over time', width),
      h('h3', {}, 'Average latency'),
      latencyChart(points, 'Average latency over time', formatDuration, width),
      h(
        'details',
        { className: 'chart-table' },
        h('summary', {}, 'Show these numbers as a table'),
        dataTable(
          'Calls over time',
          [
            { label: 'From', cell: (p) => formatClock(p.t) },
            { label: 'Calls', num: true, cell: (p) => formatCount(p.calls) },
            { label: 'Failed', num: true, cell: (p) => formatCount(p.errors) },
            { label: 'Average', num: true, cell: (p) => (p.calls > 0 ? formatDuration(p.avgMs) : DASH) },
          ],
          series.filter((p) => p.calls > 0),
        ),
      ),
    );
  }

  async function loadMetrics() {
    const requested = windowMinutes;
    try {
      const data = await ctx.api.metrics(requested);
      if (requested !== windowMinutes) return;
      const tableWasOpen = chartBox.querySelector('details')?.open === true;
      lastMetrics = data;
      replace(summaryBox, summarySection(data.summary));
      drawCharts();
      if (tableWasOpen && chartBox.querySelector('details')) chartBox.querySelector('details').open = true;
      replace(toolBox, data.byTool.length === 0 ? emptyState('No tool was called in this period') : byToolTable(data.byTool));
    } catch (err) {
      if (ctx.blocked(err)) return;
      replace(summaryBox, errorState(describeError(err), () => refresher.now()));
    }
  }

  function renderCalls() {
    replace(
      callsBox,
      calls.length === 0
        ? emptyState('No calls recorded', toolFilter ? `Nothing called ${toolFilter} yet.` : 'Tool calls made by an agent or in the playground are listed here.')
        : callsTable(calls),
    );
    olderButton.hidden = nextBefore === null || nextBefore === undefined;
  }

  async function loadCalls() {
    const requested = toolFilter;
    try {
      const data = await ctx.api.calls({ limit: PAGE, tool: requested });
      if (requested !== toolFilter) return;
      if (calls.length <= PAGE) {
        calls = data.calls;
        nextBefore = data.nextBefore;
      } else {
        // Older pages were loaded: keep them and put only the new calls on top.
        const known = new Set(calls.map((c) => c.id));
        calls = [...data.calls.filter((c) => !known.has(c.id)), ...calls];
      }
      renderCalls();
    } catch (err) {
      if (ctx.blocked(err)) return;
      replace(callsBox, errorState(describeError(err), () => refresher.now()));
    }
  }

  async function loadOlder() {
    if (!nextBefore) return;
    olderButton.disabled = true;
    try {
      const data = await ctx.api.calls({ limit: PAGE, before: nextBefore, tool: toolFilter });
      const known = new Set(calls.map((c) => c.id));
      calls = [...calls, ...data.calls.filter((c) => !known.has(c.id))];
      nextBefore = data.nextBefore;
      renderCalls();
    } catch (err) {
      if (!ctx.blocked(err)) callsBox.append(errorState(describeError(err)));
    } finally {
      olderButton.disabled = false;
    }
  }

  function setWindow(minutes) {
    windowMinutes = minutes;
    windowButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(WINDOWS[i][0] === minutes)));
    refresher.now();
  }

  function setTool(tool) {
    toolFilter = tool;
    calls = [];
    nextBefore = null;
    replace(callsBox, loadingState('recent calls'));
    refresher.now();
  }

  replace(
    container,
    h(
      'div',
      { className: 'page-head' },
      h('div', {}, h('h1', {}, 'Metrics'), h('p', {}, 'Tool calls recorded by the Hesman server of this project. Refreshes every few seconds.')),
      h('div', { className: 'segmented', role: 'group', 'aria-label': 'Period' }, windowButtons),
    ),
    summaryBox,
    h('section', { className: 'section' }, h('h2', {}, 'Over time'), chartBox),
    h('section', { className: 'section' }, h('h2', {}, 'By tool'), toolBox),
    h(
      'section',
      { className: 'section' },
      h('h2', {}, 'Recent calls'),
      h('div', { className: 'toolbar' }, h('div', { className: 'field' }, h('label', { htmlFor: 'calls-tool' }, 'Tool'), toolSelect)),
      callsBox,
      olderButton,
    ),
  );

  ctx.api
    .tools()
    .then((data) => toolSelect.append(...data.tools.map((tool) => h('option', { value: tool.name }, tool.name))))
    .catch(() => {}); // The filter then only offers "All tools"; the tables report real failures.

  const refresher = poll(() => Promise.all([loadMetrics(), loadCalls()]), 5000);
  let lastWidth = 0;
  const observer = new ResizeObserver(() => {
    const width = Math.floor(chartBox.clientWidth);
    if (width !== lastWidth) {
      lastWidth = width;
      drawCharts();
    }
  });
  observer.observe(chartBox);
  return () => {
    refresher.stop();
    observer.disconnect();
  };
}
