// Overview: which project, how far the index is, what it contains and whether its parts work.
// Data: GET /api/status (polled by main.js, faster while indexing).

import { dataTable, emptyState, h, loadingState, mark, replace } from '../dom.js';
import { DASH, formatCount, formatDateTime, formatRelative } from '../lib/format.js';
import { TIER_NOTES, healthRows, indexSummary, languageRows, limitationOf, limitationRows } from '../lib/status-model.js';

const fact = (term, ...value) => [h('dt', {}, term), h('dd', {}, value)];

function indexSection(status) {
  const index = status.index ?? {};
  const summary = indexSummary(index);
  const now = Date.parse(status.serverTime) || Date.now();
  const progressLimit = limitationOf(status, 'indexing_progress');
  const progress =
    summary.state === 'busy'
      ? h(
          'div',
          { className: 'progress-block' },
          summary.progress === null
            ? h('progress', { 'aria-label': summary.label })
            : h('progress', { max: 1, value: summary.progress, 'aria-label': summary.label }),
          h('p', { className: 'muted' }, summary.detail || 'Counting files'),
        )
      : null;
  return h(
    'section',
    { className: 'section', 'aria-labelledby': 'index-heading' },
    h('h2', { id: 'index-heading' }, 'Index'),
    h('p', { className: 'index-state', role: 'status' }, mark(summary.state, summary.label)),
    progress,
    summary.state !== 'busy' && summary.detail ? h('p', { className: summary.state === 'error' ? 'notice notice-error' : 'muted' }, summary.detail) : null,
    summary.state === 'busy' ? h('p', { className: 'notice' }, 'Search and graph results are incomplete until indexing finishes.') : null,
    progressLimit && summary.state !== 'busy' ? h('p', { className: 'muted' }, `This state is what is stored on disk. ${progressLimit.reason}`) : null,
    h(
      'dl',
      { className: 'figures' },
      h('div', {}, h('dt', {}, 'Files with symbols'), h('dd', {}, formatCount(index.totalFiles))),
      h('div', {}, h('dt', {}, 'Symbols'), h('dd', {}, formatCount(index.totalSymbols))),
      h('div', {}, h('dt', {}, 'Relations'), h('dd', {}, formatCount(index.totalRelations))),
      h('div', {}, h('dt', {}, 'Text files'), h('dd', {}, formatCount(index.textTier?.files))),
      h('div', {}, h('dt', {}, 'Text chunks'), h('dd', {}, formatCount(index.textTier?.chunks))),
    ),
    h(
      'dl',
      { className: 'facts' },
      fact('Last full index', index.lastFullIndexTime ? `${formatRelative(index.lastFullIndexTime, now)} (${formatDateTime(index.lastFullIndexTime)})` : 'Never finished'),
      fact('Files waiting', formatCount(index.pendingFiles ?? 0)),
    ),
  );
}

function languageSection(index) {
  const rows = languageRows(index);
  const body =
    rows.length === 0
      ? emptyState('No languages yet', 'Languages appear here as files are indexed.')
      : dataTable(
          'Indexed languages',
          [
            { label: 'Language', code: true, cell: (r) => r.language },
            { label: 'Tier', cell: (r) => h('span', { className: `tier tier-${r.tier}`, title: TIER_NOTES[r.tier] ?? '' }, r.tier) },
            { label: 'Files', num: true, cell: (r) => formatCount(r.files) },
            { label: 'Symbols', num: true, cell: (r) => (r.symbols === null ? DASH : formatCount(r.symbols)) },
            { label: 'Text chunks', num: true, cell: (r) => (r.chunks === null ? DASH : formatCount(r.chunks)) },
          ],
          rows,
        );
  return h(
    'section',
    { className: 'section', 'aria-labelledby': 'languages-heading' },
    h('h2', { id: 'languages-heading' }, 'Languages'),
    body,
    rows.length > 0
      ? h(
          'ul',
          { className: 'legend' },
          ['deep', 'structural', 'text'].map((tier) => h('li', {}, h('span', { className: `tier tier-${tier}` }, tier), ` ${TIER_NOTES[tier]}`)),
        )
      : null,
  );
}

function healthSection(status) {
  const rows = healthRows(status.index?.health, limitationOf(status, 'semantic_search'));
  return h(
    'section',
    { className: 'section', 'aria-labelledby': 'health-heading' },
    h('h2', { id: 'health-heading' }, 'Health'),
    rows.length === 0
      ? emptyState('No health report', 'The server did not send one.')
      : h(
          'ul',
          { className: 'health' },
          rows.map((row) => h('li', {}, h('span', { className: 'health-name' }, row.name), mark(row.state, row.label), row.detail ? h('span', { className: 'muted' }, row.detail) : null)),
        ),
  );
}

function projectSection(status) {
  return h(
    'section',
    { className: 'section', 'aria-labelledby': 'server-heading' },
    h('h2', { id: 'server-heading' }, 'Server'),
    h(
      'dl',
      { className: 'facts' },
      fact('Project folder', h('code', {}, status.projectRoot ?? DASH)),
      fact('Data folder', h('code', {}, status.dataDir ?? DASH)),
      fact('Hesman version', status.version ?? DASH),
      fact('Server time', formatDateTime(status.serverTime)),
    ),
  );
}

function limitsSection(status) {
  const rows = limitationRows(status);
  if (rows.length === 0) return null;
  return h(
    'section',
    { className: 'section', 'aria-labelledby': 'limits-heading' },
    h('h2', { id: 'limits-heading' }, 'Not available in this dashboard'),
    h('ul', { className: 'health' }, rows.map((row) => h('li', {}, h('span', { className: 'health-name' }, row.name), mark('warn', 'Unavailable'), h('span', { className: 'muted' }, row.reason)))),
  );
}

export function mount(container, ctx) {
  const body = h('div', {}, loadingState('the project status'));
  replace(container, body);
  return ctx.onStatus((status) => {
    const name = String(status.projectRoot ?? '').split(/[\\/]/).filter(Boolean).pop() || 'Project';
    replace(
      body,
      h('div', { className: 'page-head' }, h('div', {}, h('h1', {}, name), h('p', { className: 'code' }, status.projectRoot ?? ''))),
      h('div', { className: 'columns' }, h('div', {}, indexSection(status), languageSection(status.index)), h('div', {}, healthSection(status), limitsSection(status), projectSection(status))),
    );
  });
}
