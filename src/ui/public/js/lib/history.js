// The playground's short run history, kept in the browser only. `storage` is a
// `localStorage`-like object; it may be missing or throw (private windows), so every access is guarded.

export const HISTORY_KEY = 'hesman.playground.history';
export const HISTORY_MAX = 20;

export function loadHistory(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.tool === 'string') : [];
  } catch {
    return [];
  }
}

const sameRun = (a, b) => a.tool === b.tool && JSON.stringify(a.args) === JSON.stringify(b.args);

/** Add a run `{ tool, args, time, durationMs, isError }` and return the new list, newest first. */
export function pushHistory(storage, entry, max = HISTORY_MAX) {
  const previous = loadHistory(storage);
  const rest = previous.length > 0 && sameRun(previous[0], entry) ? previous.slice(1) : previous;
  const next = [entry, ...rest].slice(0, max);
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Nothing to do: the history simply does not persist in this browser.
  }
  return next;
}
