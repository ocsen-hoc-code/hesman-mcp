// Log list helpers. No DOM access.

import { parseTime } from './format.js';

/** Severity order used by the level filter ("this level and above"). */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/** Entries carry no id in the API, so identity is the visible content. */
const keyOf = (entry) => `${entry.time}|${entry.level}|${entry.name}|${entry.msg}`;

/** Merge a fresh page into the list shown: no duplicates, newest first, at most `max` entries. */
export function mergeLogEntries(existing, incoming, max = 2000) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...incoming, ...existing]) {
    const key = keyOf(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  // Array.prototype.sort is stable, so entries with equal times keep the server's order.
  merged.sort((a, b) => (parseTime(b.time) ?? 0) - (parseTime(a.time) ?? 0));
  return merged.slice(0, max);
}

/** Structured fields as `[key, printable value]` rows. */
export function fieldRows(fields) {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return [];
  return Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]);
}
