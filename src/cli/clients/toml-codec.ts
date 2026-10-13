import { SERVER_NAME } from './entry.js';
import type { ConfigCodec, EntryValue } from './codec.js';
import type { ServerEntry } from './types.js';

/**
 * Format-preserving editor for the `[mcp_servers.hesman]` table of a Codex `config.toml`.
 *
 * This is deliberately not a TOML parser. It finds table headers line by line (skipping
 * multi-line strings), treats the hesman table as a block of text, and never rewrites a byte
 * outside that block, so comments, key order and formatting of everything else survive.
 * Forms it cannot edit as a block (inline tables, dotted keys) are refused with an error
 * instead of being guessed at.
 *
 * Known limit: a line of a multi-line array that holds only a bracketed value (`  ["a"]`) looks
 * like a table header to the line scanner.
 */

const SERVERS_TABLE = 'mcp_servers';

interface Line {
  /** Line content including its line ending. */
  raw: string;
  /** Key path of the table header on this line (`[a.b]` → `['a', 'b']`). */
  header?: string[];
  /** Key path of the table this line belongs to (`[]` before the first header). */
  table: string[];
}

function parseKeyPath(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+)/g)) {
    keys.push(match[1] ?? match[2] ?? match[3]);
  }
  return keys;
}

function scan(text: string): Line[] {
  const lines: Line[] = [];
  let table: string[] = [];
  let openString: '"""' | "'''" | undefined;

  for (const raw of text.split(/(?<=\n)/)) {
    const startedInsideString = openString !== undefined;
    for (let pos = 0; ; ) {
      if (openString) {
        const end = raw.indexOf(openString, pos);
        if (end === -1) break;
        pos = end + 3;
        openString = undefined;
      } else {
        const next = raw.slice(pos).match(/"""|'''/);
        if (!next || next.index === undefined) break;
        openString = next[0] as '"""' | "'''";
        pos += next.index + 3;
      }
    }

    const line: Line = { raw, table };
    if (!startedInsideString) {
      const content = raw.replace(/\r?\n$/, '');
      const single = content.match(/^\s*\[([^[\]]+)\]\s*(#.*)?$/);
      const array = single ? null : content.match(/^\s*\[\[([^[\]]+)\]\]\s*(#.*)?$/);
      if (single || array) {
        table = parseKeyPath((single ?? array)![1]);
        line.header = table;
        line.table = table;
      }
    }
    lines.push(line);
  }
  return lines;
}

const isHesmanPath = (path: string[]): boolean => path[0] === SERVERS_TABLE && path[1] === SERVER_NAME;

interface Located {
  lines: Line[];
  /** Index of the `[mcp_servers.hesman]` header line. */
  start: number;
  /** First line after the main table (the next header of any kind, or the end). */
  mainEnd: number;
  /** First line after the table and its sub-tables (`[mcp_servers.hesman.env]`, …). */
  end: number;
}

function locate(text: string | undefined, path: string): Located | undefined {
  if (text === undefined) return undefined;
  const lines = scan(text);
  const refuse = (): never => {
    throw new Error(
      `The Hesman server in ${path} is not written as a [${SERVERS_TABLE}.${SERVER_NAME}] table, ` +
        'so it cannot be changed safely. Please edit that file by hand.',
    );
  };

  const key = `["']?${SERVER_NAME}["']?`;
  for (const line of lines) {
    if (line.header) continue;
    const atRoot = line.table.length === 0;
    const inServers = line.table.length === 1 && line.table[0] === SERVERS_TABLE;
    if (atRoot && new RegExp(`^\\s*${SERVERS_TABLE}\\s*\\.\\s*${key}\\s*[.=]`).test(line.raw)) refuse();
    if (atRoot && new RegExp(`^\\s*${SERVERS_TABLE}\\s*=.*\\b${SERVER_NAME}\\b`).test(line.raw)) refuse();
    if (inServers && new RegExp(`^\\s*${key}\\s*[.=]`).test(line.raw)) refuse();
  }

  const start = lines.findIndex((l) => l.header && l.header.length === 2 && isHesmanPath(l.header));
  if (start === -1) {
    if (lines.some((l) => l.header && isHesmanPath(l.header))) refuse();
    return undefined;
  }
  const nextHeader = (from: number, stop: (header: string[]) => boolean): number => {
    for (let i = from; i < lines.length; i++) {
      const header = lines[i].header;
      if (header && stop(header)) return i;
    }
    return lines.length;
  };
  return {
    lines,
    start,
    mainEnd: nextHeader(start + 1, () => true),
    end: nextHeader(start + 1, (header) => !isHesmanPath(header)),
  };
}

/** Parses a TOML string starting at `text[pos]`; returns its value and the index after it. */
function readString(text: string, pos: number): { value: string; end: number } | undefined {
  const quote = text[pos];
  if (quote === "'") {
    const close = text.indexOf("'", pos + 1);
    return close === -1 ? undefined : { value: text.slice(pos + 1, close), end: close + 1 };
  }
  if (quote !== '"') return undefined;
  for (let i = pos + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') {
      const literal = text.slice(pos, i + 1);
      try {
        return { value: JSON.parse(literal) as string, end: i + 1 };
      } catch {
        // TOML-only escapes (\e, \UXXXXXXXX): keep the raw text rather than fail.
        return { value: literal.slice(1, -1), end: i + 1 };
      }
    }
  }
  return undefined;
}

/** Reads the array whose `[` is at `text[open]`: its string items and the index after `]`. */
function readArray(text: string, open: number): { items: string[]; end: number } | undefined {
  const items: string[] = [];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '#') {
      const eol = text.indexOf('\n', i);
      if (eol === -1) return undefined;
      i = eol;
    } else if (ch === '"' || ch === "'") {
      const str = readString(text, i);
      if (!str) return undefined;
      if (depth === 1) items.push(str.value);
      i = str.end - 1;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return { items, end: i + 1 };
    }
  }
  return undefined;
}

interface KeySpan {
  /** Offsets of the whole `key = value` statement, without the line ending. */
  from: number;
  to: number;
}

function endOfLine(text: string, from: number): number {
  const eol = text.indexOf('\n', from);
  const end = eol === -1 ? text.length : eol;
  return text[end - 1] === '\r' ? end - 1 : end;
}

function findKey(body: string, name: string): (KeySpan & { valueAt: number }) | undefined {
  const match = new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*`, 'm').exec(body);
  if (!match) return undefined;
  const valueAt = match.index + match[0].length;
  return { from: match.index, to: endOfLine(body, valueAt), valueAt };
}

function readTable(body: string): { command?: string; args: string[]; commandSpan?: KeySpan; argsSpan?: KeySpan } {
  const commandKey = findKey(body, 'command');
  const argsKey = findKey(body, 'args');
  const array = argsKey && body[argsKey.valueAt] === '[' ? readArray(body, argsKey.valueAt) : undefined;
  return {
    command: commandKey ? readString(body, commandKey.valueAt)?.value : undefined,
    args: array?.items ?? [],
    commandSpan: commandKey,
    argsSpan: argsKey && { from: argsKey.from, to: array ? endOfLine(body, array.end) : argsKey.to },
  };
}

const tomlString = (value: string): string => JSON.stringify(value);
const commandLine = (entry: ServerEntry): string => `command = ${tomlString(entry.command)}`;
const argsLine = (entry: ServerEntry): string => `args = [${entry.args.map(tomlString).join(', ')}]`;

function block(entry: ServerEntry, eol: string): string {
  return [`[${SERVERS_TABLE}.${SERVER_NAME}]`, commandLine(entry), argsLine(entry)].map((l) => l + eol).join('');
}

const eolOf = (text: string | undefined): string => (text?.includes('\r\n') ? '\r\n' : '\n');
const join = (lines: Line[]): string => lines.map((l) => l.raw).join('');
const isBlank = (line: Line | undefined): boolean => line !== undefined && line.raw.trim() === '';

function append(text: string | undefined, entry: ServerEntry): string {
  const eol = eolOf(text);
  if (text === undefined || text === '') return block(entry, eol);
  return text + (text.endsWith('\n') ? '' : eol) + eol + block(entry, eol);
}

function updateInPlace(found: Located, entry: ServerEntry, eol: string): string {
  const before = join(found.lines.slice(0, found.start + 1));
  let body = join(found.lines.slice(found.start + 1, found.mainEnd));
  const after = join(found.lines.slice(found.mainEnd));

  const replace = (span: KeySpan | undefined, statement: string, insertAt: number): void => {
    body = span
      ? body.slice(0, span.from) + statement + body.slice(span.to)
      : body.slice(0, insertAt) + statement + eol + body.slice(insertAt);
  };
  // A missing key is inserted at the top of the table; doing `args` first puts `command` above it.
  replace(readTable(body).argsSpan, argsLine(entry), 0);
  replace(readTable(body).commandSpan, commandLine(entry), 0);
  return before + (before.endsWith('\n') ? '' : eol) + body + after;
}

export function tomlCodec(): ConfigCodec {
  const read = (text: string | undefined, path: string): ServerEntry | undefined => {
    const found = locate(text, path);
    if (!found) return undefined;
    const table = readTable(join(found.lines.slice(found.start + 1, found.mainEnd)));
    return table.command === undefined ? undefined : { command: table.command, args: table.args };
  };
  const toEntry = (desired: EntryValue): ServerEntry => ({ command: desired.command, args: desired.args });

  return {
    read,
    has: (text, path) => locate(text, path) !== undefined,

    matches(text, desired, path): boolean {
      const current = read(text, path);
      return (
        current !== undefined &&
        current.command === desired.command &&
        current.args.length === desired.args.length &&
        current.args.every((arg, i) => arg === desired.args[i])
      );
    },

    apply(text, desired, path): string {
      const found = locate(text, path);
      return found ? updateInPlace(found, toEntry(desired), eolOf(text)) : append(text, toEntry(desired));
    },

    strip(text, path): string {
      const found = locate(text, path);
      if (!found) return text;
      const { lines, start } = found;
      // Comments and blank lines right before the next table belong to that table.
      let end = found.end;
      if (end < lines.length) {
        while (end > start + 1 && (isBlank(lines[end - 1]) || lines[end - 1].raw.trimStart().startsWith('#'))) end--;
      }
      // Drop the blank line that separated the block from what came before it.
      const separated = isBlank(lines[start - 1]) && (end === lines.length || isBlank(lines[end]));
      return join([...lines.slice(0, separated ? start - 1 : start), ...lines.slice(end)]);
    },

    restores(backup, text, path): boolean {
      if (locate(backup, path)) return false;
      const current = read(text, path);
      return current !== undefined && append(backup, current) === text;
    },

    isOnlyHesman(text, path): boolean {
      const current = read(text, path);
      return current !== undefined && block(current, '\n') === text;
    },

    snippet: (desired) => block(toEntry(desired), '\n').trimEnd(),
  };
}
