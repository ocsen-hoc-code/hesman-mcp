// Logs: the server's structured log, newest first.
// Data: GET /api/logs?level=&q=&limit=&before=.

import { describeError } from '../api.js';
import { debounce, emptyState, errorState, h, loadingState, mark, poll, replace } from '../dom.js';
import { formatClock, formatDateTime } from '../lib/format.js';
import { LOG_LEVELS, fieldRows, logKey, mergeLogEntries } from '../lib/logs-model.js';

const PAGE = 200;
const LEVEL_STATE = { debug: 'pending', info: 'ok', warn: 'warn', error: 'error' };
const LEVEL_LABEL = { debug: 'Debug and above (everything)', info: 'Info and above', warn: 'Warnings and errors', error: 'Errors only' };

function entryRow(entry) {
  const head = [
    h('time', { className: 'log-time', dateTime: String(entry.time), title: formatDateTime(entry.time) }, formatClock(entry.time)),
    h('span', { className: 'log-level' }, mark(LEVEL_STATE[entry.level] ?? 'pending', entry.level)),
    h('span', { className: 'log-name code' }, entry.name),
    h('span', { className: 'log-msg' }, entry.msg),
  ];
  const fields = fieldRows(entry.fields);
  if (fields.length === 0) return h('li', { className: 'log-entry', dataset: { level: entry.level } }, h('div', { className: 'log-head' }, head));
  return h(
    'li',
    { className: 'log-entry', dataset: { level: entry.level } },
    h(
      'details',
      {},
      h('summary', { className: 'log-head' }, head),
      h('dl', { className: 'facts log-fields' }, fields.map(([key, value]) => [h('dt', { className: 'code' }, key), h('dd', { className: 'code' }, value)])),
    ),
  );
}

export function mount(container, ctx) {
  let level = 'info';
  let q = '';
  let entries = [];
  let nextBefore = null;
  let paused = false;
  let generation = 0; // bumped when the filters change, so late answers for old filters are dropped
  const rows = new Map(); // logKey -> <li>, reused so an expanded entry stays expanded across refreshes

  const list = h('ol', { className: 'log-list', 'aria-label': 'Log entries, newest first' });
  const stateBox = h('div', {}, loadingState('logs'));
  const updated = h('p', { className: 'muted', role: 'status' });
  const olderButton = h('button', { type: 'button', className: 'btn', hidden: true, onclick: () => loadOlder() }, 'Load older entries');
  const pauseButton = h('button', { type: 'button', className: 'btn', 'aria-pressed': 'false', onclick: () => togglePause() }, 'Pause');
  const levelSelect = h(
    'select',
    { id: 'log-level', onchange: () => resetAndLoad(() => (level = levelSelect.value)) },
    LOG_LEVELS.map((name) => h('option', { value: name, selected: name === level }, LEVEL_LABEL[name])),
  );
  const applyText = debounce(() => resetAndLoad(() => (q = textInput.value.trim())), 250);
  const textInput = h('input', { type: 'search', id: 'log-q', placeholder: 'Message, source or field value', oninput: applyText });

  function render() {
    const keep = new Set();
    const items = entries.map((entry) => {
      const key = logKey(entry);
      keep.add(key);
      if (!rows.has(key)) rows.set(key, entryRow(entry));
      return rows.get(key);
    });
    for (const key of rows.keys()) if (!keep.has(key)) rows.delete(key);
    list.replaceChildren(...items);
    replace(
      stateBox,
      entries.length === 0
        ? emptyState('No log entries match', q ? 'Clear the text filter or choose a lower level.' : level === 'info' ? 'Nothing was logged yet.' : 'Choose a lower level to see more.')
        : null,
    );
    olderButton.hidden = nextBefore === null || nextBefore === undefined;
  }

  async function refresh() {
    const mine = generation;
    try {
      const data = await ctx.api.logs({ level, q, limit: PAGE });
      if (mine !== generation) return;
      if (entries.length <= PAGE) nextBefore = data.nextBefore;
      entries = mergeLogEntries(entries, data.entries);
      render();
      updated.textContent = `${paused ? 'Paused' : 'Live'}, updated ${formatClock(Date.now())}`;
    } catch (err) {
      if (mine !== generation || ctx.blocked(err)) return;
      replace(stateBox, errorState(describeError(err), () => refresher.now()));
    }
  }

  async function loadOlder() {
    if (nextBefore === null || nextBefore === undefined) return;
    const mine = generation;
    olderButton.disabled = true;
    try {
      const data = await ctx.api.logs({ level, q, limit: PAGE, before: nextBefore });
      if (mine !== generation) return;
      entries = mergeLogEntries(entries, data.entries);
      nextBefore = data.nextBefore;
      render();
    } catch (err) {
      if (!ctx.blocked(err)) replace(stateBox, errorState(describeError(err)));
    } finally {
      olderButton.disabled = false;
    }
  }

  function resetAndLoad(change) {
    change();
    generation++;
    entries = [];
    nextBefore = null;
    rows.clear();
    list.replaceChildren();
    olderButton.hidden = true;
    replace(stateBox, loadingState('logs'));
    refresh(); // also when paused: a changed filter is an explicit request
  }

  function togglePause() {
    paused = !paused;
    refresher.setPaused(paused);
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    updated.textContent = paused ? 'Paused. New entries are not loaded.' : 'Live';
    if (!paused) refresher.now();
  }

  replace(
    container,
    h('div', { className: 'page-head' }, h('div', {}, h('h1', {}, 'Logs'), h('p', {}, 'What the Hesman server wrote to its log file, newest first.'))),
    h(
      'div',
      { className: 'toolbar' },
      h('div', { className: 'field' }, h('label', { htmlFor: 'log-level' }, 'Level'), levelSelect),
      h('div', { className: 'field field-grow' }, h('label', { htmlFor: 'log-q' }, 'Contains'), textInput),
      pauseButton,
      updated,
    ),
    list,
    stateBox,
    olderButton,
  );

  const refresher = poll(refresh, 3000);
  return () => refresher.stop();
}
