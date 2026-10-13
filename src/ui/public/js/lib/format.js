// Formatting helpers for durations, counts, tokens, times and paths. No DOM access.

export const DASH = '–';

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Trim trailing zeros: 4.30 -> "4.3", 3.0 -> "3". */
function trim(value, digits) {
  return String(Number(value.toFixed(digits)));
}

/** A duration given in milliseconds, in the unit a person would use. */
export function formatDuration(ms) {
  if (!isNumber(ms) || ms < 0) return DASH;
  if (ms === 0) return '0 ms';
  if (ms < 0.05) return '<0.1 ms';
  if (ms < 10) return `${trim(ms, 1)} ms`;
  if (ms < 999.5) return `${Math.round(ms)} ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** An integer with thousands separators. */
export function formatCount(n) {
  return isNumber(n) ? grouped.format(n) : DASH;
}

/** A token count: exact below 10,000, abbreviated above. */
export function formatTokens(n) {
  if (!isNumber(n)) return DASH;
  if (n < 10_000) return grouped.format(n);
  if (n < 1_000_000) return `${trim(n / 1000, 1)}k`;
  return `${trim(n / 1_000_000, 2)}M`;
}

/** A 0..1 ratio as a percentage with one decimal. */
export function formatPercent(ratio) {
  return isNumber(ratio) ? `${(ratio * 100).toFixed(1)}%` : DASH;
}

/** Tokens saved between the uncompressed baseline and what was returned. Never negative. */
export function tokenSavings(original, returned) {
  if (!isNumber(original) || !isNumber(returned) || original <= 0) {
    return { saved: 0, ratio: 0, label: DASH };
  }
  const saved = Math.max(0, original - returned);
  const ratio = saved / original;
  return { saved, ratio, label: formatPercent(ratio) };
}

/** Epoch milliseconds from an ISO string or an epoch-millisecond number; null when unusable. */
export function parseTime(value) {
  if (isNumber(value)) return value;
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** HH:MM:SS in the viewer's time zone (or `options.timeZone`). */
export function formatClock(value, options = {}) {
  const ms = parseTime(value);
  if (ms === null) return DASH;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: options.timeZone,
  }).format(ms);
}

/** Date and time, for tooltips and details. */
export function formatDateTime(value, options = {}) {
  const ms = parseTime(value);
  if (ms === null) return DASH;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: options.timeZone,
  }).format(ms);
}

/** "5 min ago" relative to `now` (epoch ms). */
export function formatRelative(value, now = Date.now()) {
  const ms = parseTime(value);
  if (ms === null) return 'never';
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/** Shorten a project-relative path to `max` characters, keeping the file name. */
export function shortPath(path, max = 40) {
  if (typeof path !== 'string') return '';
  if (path.length <= max) return path;
  const parts = path.split('/');
  const file = parts[parts.length - 1];
  if (parts.length > 2) {
    const candidate = `${parts[0]}/…/${file}`;
    if (candidate.length <= max) return candidate;
  }
  if (file.length + 2 <= max && parts.length > 1) return `…/${file}`;
  return `…${file.slice(file.length - (max - 1))}`;
}
