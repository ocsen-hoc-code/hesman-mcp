import { resolve, sep } from 'node:path';

/**
 * The dashboard never shows absolute paths of the machine: every path below
 * the project root leaves the API project-relative, with `/` separators.
 */

/** `filePath` relative to `projectRoot` with `/`; unchanged when it is not below the root. */
export function toProjectRelative(projectRoot: string, filePath: string): string {
  const root = resolve(projectRoot);
  if (filePath === root) return '.';
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!filePath.startsWith(prefix)) return filePath;
  const rest = filePath.slice(prefix.length);
  return sep === '/' ? rest : rest.split(sep).join('/');
}

function relativizeString(root: string, prefix: string, text: string): string {
  if (text === root) return '.';
  if (!text.includes(prefix)) return text;
  if (text.startsWith(prefix) && !/\s/.test(text)) return toProjectRelative(root, text);
  // A path inside a longer text (an error message, a log line): drop the root.
  return text.split(prefix).join('');
}

/**
 * A copy of a JSON value in which every string that is, or contains, a path
 * below `projectRoot` has that path made project-relative.
 */
export function relativizePaths<T>(projectRoot: string, value: T): T {
  const root = resolve(projectRoot);
  const prefix = root.endsWith(sep) ? root : root + sep;
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') return relativizeString(root, prefix, item);
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(item)) out[key] = walk(child);
      return out;
    }
    return item;
  };
  return walk(value) as T;
}
