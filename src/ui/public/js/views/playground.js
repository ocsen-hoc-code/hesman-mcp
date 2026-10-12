/* global localStorage, CSS */
// Query playground: run any tool the server lists with a form built from its input schema.
// Data: GET /api/tools, POST /api/tools/:name. The run history stays in this browser.

import { describeError } from '../api.js';
import { emptyState, errorState, h, loadingState, mark, replace } from '../dom.js';
import { formatClock, formatDuration, formatTokens } from '../lib/format.js';
import { HISTORY_KEY, loadHistory, pushHistory } from '../lib/history.js';
import { buildFormModel, coerceValues, initialValues } from '../lib/schema-form.js';
import { summarizeToolRun } from '../lib/tool-result.js';

function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function parseArgs(text) {
  try {
    const value = JSON.parse(text ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function control(field, value, id) {
  const common = { id, name: field.name, required: field.required, 'aria-describedby': `${id}-hint ${id}-problem` };
  switch (field.control) {
    case 'select':
      return h('select', common, field.required ? null : h('option', { value: '' }, 'Default'), field.options.map((o) => h('option', { value: String(o), selected: String(o) === value }, String(o))));
    case 'boolean':
      return h('select', common, field.required ? null : h('option', { value: '' }, 'Default'), ['true', 'false'].map((o) => h('option', { value: o, selected: o === value }, o === 'true' ? 'Yes' : 'No')));
    case 'integer':
    case 'number':
      return h('input', { ...common, type: 'number', inputMode: field.control === 'integer' ? 'numeric' : 'decimal', min: field.min, max: field.max, step: field.control === 'integer' ? 1 : 'any', value });
    case 'json':
      return h('textarea', { ...common, rows: 3, spellcheck: false, value });
    default:
      return h('input', { ...common, type: 'text', maxLength: field.maxLength, spellcheck: false, autocomplete: 'off', value });
  }
}

function rangeText(field) {
  if (field.min !== undefined && field.max !== undefined) return `${field.min} to ${field.max}. `;
  if (field.min !== undefined) return `At least ${field.min}. `;
  if (field.max !== undefined) return `At most ${field.max}. `;
  return '';
}

function resultSection(run) {
  const summary = summarizeToolRun(run);
  const meta = summary.meta;
  return [
    h(
      'dl',
      { className: 'figures figures-compact' },
      h('div', {}, h('dt', {}, 'Result'), h('dd', {}, summary.isError ? mark('error', `Tool error${summary.error?.code ? `: ${summary.error.code}` : ''}`) : mark('ok', 'OK'))),
      h('div', {}, h('dt', {}, 'Duration'), h('dd', {}, formatDuration(summary.durationMs))),
      h('div', {}, h('dt', {}, 'Tokens before compression'), h('dd', {}, formatTokens(meta?.originalTokens))),
      h('div', {}, h('dt', {}, 'Tokens returned'), h('dd', {}, formatTokens(meta?.compressedTokens))),
      h('div', {}, h('dt', {}, 'Reduction'), h('dd', {}, meta?.reduction ?? '–')),
      meta && meta.layers.length > 0 ? h('div', {}, h('dt', {}, 'Compression steps'), h('dd', {}, meta.layers.join(', '))) : null,
    ),
    summary.isError && summary.error ? h('p', { className: 'notice notice-error' }, summary.error.message) : null,
    summary.indexing?.inProgress ? h('p', { className: 'notice' }, `The index is still being built (${summary.indexing.filesDone} of ${summary.indexing.filesTotal} files), so this answer may be incomplete.`) : null,
    !meta && !summary.isError ? h('p', { className: 'muted' }, 'This tool reports no token numbers.') : null,
    h('pre', { className: 'json', tabindex: 0, 'aria-label': 'JSON result' }, summary.json || '(empty result)'),
  ];
}

export function mount(container, ctx) {
  let tools = [];
  let current = null; // { tool, model }
  let alive = true;
  const store = storage();

  const toolSelect = h('select', { id: 'tool-select', onchange: () => chooseTool(toolSelect.value) });
  const description = h('p', { className: 'muted', id: 'tool-description' });
  const formBox = h('div', {}, loadingState('the tool list'));
  const resultBox = h('div', { 'aria-live': 'polite' });
  const historyBox = h('div', {});

  function renderHistory() {
    const list = loadHistory(store);
    replace(
      historyBox,
      list.length === 0
        ? h('p', { className: 'muted' }, 'Runs you make here are listed for reuse. They are stored in this browser only.')
        : [
            h(
              'ol',
              { className: 'history' },
              list.map((entry) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    { type: 'button', className: 'result', title: 'Fill the form with these arguments', onclick: () => chooseTool(entry.tool, entry.args) },
                    h('span', { className: 'code' }, entry.tool),
                    h('span', { className: 'muted code history-args' }, ` ${JSON.stringify(entry.args)}`),
                    h('span', { className: 'history-meta' }, mark(entry.isError ? 'error' : 'ok', entry.isError ? 'error' : 'ok'), ` ${formatClock(entry.time)}, ${formatDuration(entry.durationMs)}`),
                  ),
                ),
              ),
            ),
            h('button', { type: 'button', className: 'btn btn-quiet', onclick: clearHistory }, 'Clear history'),
          ],
    );
  }

  function clearHistory() {
    try {
      store?.removeItem(HISTORY_KEY);
    } catch {
      // Nothing was stored, so there is nothing to clear.
    }
    renderHistory();
  }

  function chooseTool(name, prefill) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) return;
    toolSelect.value = name;
    description.textContent = tool.description ?? '';
    const model = buildFormModel(tool.inputSchema);
    current = { tool, model };
    const values = initialValues(model, prefill);
    const runButton = h('button', { type: 'submit', className: 'btn btn-primary' }, `Run ${tool.name}`);
    const form = h(
      'form',
      { className: 'tool-form', noValidate: true, 'aria-describedby': 'tool-description', onsubmit: (event) => run(event, form, runButton) },
      model.fields.length === 0 ? h('p', { className: 'muted' }, 'This tool takes no arguments.') : null,
      model.fields.map((field) => {
        const id = `arg-${field.name}`;
        return h(
          'div',
          { className: 'field', dataset: { field: field.name } },
          h('label', { htmlFor: id }, h('span', { className: 'code' }, field.name), field.required ? h('span', { className: 'required' }, ' required') : null),
          control(field, values[field.name], id),
          h('p', { className: 'hint', id: `${id}-hint` }, `${rangeText(field)}${field.description}`),
          h('p', { className: 'problem', id: `${id}-problem` }),
        );
      }),
      runButton,
    );
    replace(formBox, form);
    replace(resultBox, h('p', { className: 'muted' }, 'Run the tool to see its answer here.'));
  }

  async function run(event, form, runButton) {
    event.preventDefault();
    const { tool, model } = current;
    const inputOf = (field) => form.querySelector(`#arg-${CSS.escape(field.name)}`);
    const raw = Object.fromEntries(model.fields.map((f) => [f.name, inputOf(f).value]));
    const checked = coerceValues(model, raw);
    let firstInvalid = null;
    for (const field of model.fields) {
      const input = inputOf(field);
      const problem = checked.errors[field.name] ?? '';
      input.setAttribute('aria-invalid', String(problem !== ''));
      form.querySelector(`#arg-${CSS.escape(field.name)}-problem`).textContent = problem;
      if (problem && !firstInvalid) firstInvalid = input;
    }
    if (!checked.ok) {
      firstInvalid.focus();
      return;
    }
    runButton.disabled = true;
    replace(resultBox, loadingState(`the answer of ${tool.name}`));
    try {
      const data = await ctx.api.runTool(tool.name, checked.args);
      if (!alive) return;
      pushHistory(store ?? { getItem: () => null, setItem: () => {} }, { tool: tool.name, args: checked.args, time: Date.now(), durationMs: data.durationMs, isError: data.isError === true });
      renderHistory();
      if (current.tool === tool) replace(resultBox, resultSection(data));
    } catch (err) {
      if (!alive || ctx.blocked(err)) return;
      replace(resultBox, errorState(describeError(err)));
    } finally {
      runButton.disabled = false;
    }
  }

  async function loadTools() {
    replace(formBox, loadingState('the tool list'));
    try {
      const data = await ctx.api.tools();
      if (!alive) return;
      tools = Array.isArray(data.tools) ? data.tools : [];
      if (tools.length === 0) {
        replace(formBox, emptyState('The server lists no tools', 'Restart `hesman ui` and reload this page.'));
        return;
      }
      replace(toolSelect, tools.map((tool) => h('option', { value: tool.name }, tool.name)));
      const wanted = tools.some((t) => t.name === ctx.params.tool) ? ctx.params.tool : tools[0].name;
      chooseTool(wanted, wanted === ctx.params.tool ? parseArgs(ctx.params.args) : undefined);
    } catch (err) {
      if (!alive || ctx.blocked(err)) return;
      replace(formBox, errorState(describeError(err), loadTools));
    }
  }

  replace(
    container,
    h('div', { className: 'page-head' }, h('div', {}, h('h1', {}, 'Playground'), h('p', {}, 'Run a tool exactly as an agent would and see what comes back. Tools only read the index and the project files.'))),
    h(
      'div',
      { className: 'columns' },
      h('div', {}, h('div', { className: 'field' }, h('label', { htmlFor: 'tool-select' }, 'Tool'), toolSelect, description), formBox, h('section', { className: 'section' }, h('h2', {}, 'Result'), resultBox)),
      h('section', { className: 'section section-first', 'aria-labelledby': 'history-heading' }, h('h2', { id: 'history-heading' }, 'History'), historyBox),
    ),
  );
  renderHistory();
  loadTools();

  return () => {
    alive = false;
  };
}
