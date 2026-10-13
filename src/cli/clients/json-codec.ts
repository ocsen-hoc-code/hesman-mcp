import { isDeepStrictEqual } from 'node:util';
import { SERVER_NAME } from './entry.js';
import type { ConfigCodec, EntryValue } from './codec.js';
import type { ServerEntry } from './types.js';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDocument(text: string | undefined, path: string): JsonObject {
  if (text === undefined || text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid JSON in existing config at ${path}: ${reason}. ` +
        'Hesman does not edit files it cannot parse (comments and trailing commas are not supported); fix the file or add the entry by hand.',
    );
  }
  if (!isObject(parsed)) throw new Error(`Invalid JSON in existing config at ${path}: the top level is not an object.`);
  return parsed;
}

/** Indentation of the first indented line, so a rewritten file keeps the user's style. */
function indentOf(text: string | undefined): string {
  return text?.match(/^([ \t]+)\S/m)?.[1] ?? '  ';
}

/** Serializes `doc` in the style of `like`: same indentation, line endings and trailing newline. */
function render(doc: JsonObject, like: string | undefined): string {
  const blank = like === undefined || like.trim() === '';
  let out = JSON.stringify(doc, null, indentOf(like));
  if (blank || like.endsWith('\n')) out += '\n';
  return !blank && like.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out;
}

/**
 * Codec for JSON config files that keep servers in one top-level object
 * (`mcpServers`, or `servers` for VS Code). Only the `hesman` member is ever changed.
 */
export function jsonCodec(key: string): ConfigCodec {
  const serversOf = (doc: JsonObject, path: string): JsonObject => {
    const servers = doc[key];
    if (servers === undefined) return {};
    if (!isObject(servers)) throw new Error(`Invalid config at ${path}: "${key}" is not an object.`);
    return servers;
  };
  const rawEntry = (text: string | undefined, path: string): unknown => serversOf(parseDocument(text, path), path)[SERVER_NAME];
  const put = (text: string | undefined, value: unknown, path: string): string => {
    const doc = parseDocument(text, path);
    return render({ ...doc, [key]: { ...serversOf(doc, path), [SERVER_NAME]: value } }, text);
  };

  return {
    read(text, path): ServerEntry | undefined {
      const raw = rawEntry(text, path);
      if (!isObject(raw) || typeof raw.command !== 'string') return undefined;
      const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [];
      return { command: raw.command, args };
    },

    has: (text, path) => rawEntry(text, path) !== undefined,

    matches(text, desired, path): boolean {
      const raw = rawEntry(text, path);
      // `cwd` pinned the server to one directory (written by `hesman install` before M2-03).
      if (!isObject(raw) || 'cwd' in raw) return false;
      return Object.entries(desired).every(([name, value]) => isDeepStrictEqual(raw[name], value));
    },

    apply(text, desired, path): string {
      const raw = rawEntry(text, path);
      const { cwd: _cwd, ...kept } = isObject(raw) ? raw : {};
      return put(text, { ...kept, ...desired }, path);
    },

    strip(text, path): string {
      const doc = parseDocument(text, path);
      const { [SERVER_NAME]: _removed, ...others } = serversOf(doc, path);
      return render({ ...doc, [key]: others }, text);
    },

    restores(backup, text, path): boolean {
      return rawEntry(backup, path) === undefined && put(backup, rawEntry(text, path), path) === text;
    },

    isOnlyHesman(text, path): boolean {
      return put(undefined, rawEntry(text, path), path) === text;
    },

    snippet: (desired: EntryValue) => JSON.stringify({ [key]: { [SERVER_NAME]: desired } }, null, 2),
  };
}
