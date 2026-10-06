/**
 * Pure matching logic for `find_pattern`.
 *
 * Kept free of logger/store imports so it can be loaded cheaply inside the
 * matching worker thread (see find-pattern-worker.ts).
 */

/** Maximum pattern length in characters. */
export const MAX_PATTERN_LENGTH = 500;
/** Maximum number of placeholders ($NAME and $$$NAME combined). */
export const MAX_PLACEHOLDERS = 8;
/** Maximum number of greedy $$$NAME placeholders. */
export const MAX_GREEDY_PLACEHOLDERS = 3;
/** Lines longer than this (typically minified/generated code) are not searched. */
export const MAX_LINE_LENGTH = 4_000;
/** Overlong lines shown in a snippet are cut to this many characters. */
const SNIPPET_LINE_PREVIEW = 200;

export interface PatternMatch {
  filePath: string;
  /** 1-based line number of the start of the match. */
  line: number;
  snippet: string;
  bindings: Record<string, string>;
}

/** Returns an error message naming the violated limit, or null when the pattern is acceptable. */
export function validatePattern(pattern: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `pattern is ${pattern.length} characters; the limit is ${MAX_PATTERN_LENGTH}`;
  }
  const greedy = (pattern.match(/\$\$\$\w+/g) ?? []).length;
  if (greedy > MAX_GREEDY_PLACEHOLDERS) {
    return `pattern has ${greedy} $$$ placeholders; the limit is ${MAX_GREEDY_PLACEHOLDERS}`;
  }
  const words = (pattern.replace(/\$\$\$\w+/g, '').match(/\$\w+/g) ?? []).length;
  const total = greedy + words;
  if (total > MAX_PLACEHOLDERS) {
    return `pattern has ${total} placeholders; the limit is ${MAX_PLACEHOLDERS}`;
  }
  return null;
}

/**
 * Compile a user-friendly structural pattern into a regex source string.
 *
 * Syntax:
 *   $NAME      → named capture group matching \w+ (word characters)
 *   $$$ARGS    → named capture group matching .+  (greedy, any characters on a line)
 *
 * All regex special characters are escaped first, then the $NAME / $$$ARGS
 * placeholders are selectively un-escaped. Throws on invalid patterns
 * (e.g. a repeated capture name).
 */
export function compilePattern(pattern: string): string {
  let regex = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  regex = regex.replace(/\\\$\\\$\\\$(\w+)/g, '(?<$1>.+)');
  regex = regex.replace(/\\\$(\w+)/g, '(?<$1>\\w+)');
  // Validate eagerly so the caller can report INVALID_INPUT.
  new RegExp(regex, 'g');
  return regex;
}

/** Offsets at which each line starts (index 0 → line 1). */
export function buildLineStarts(text: string): number[] {
  const starts = [0];
  let idx = text.indexOf('\n');
  while (idx !== -1) {
    starts.push(idx + 1);
    idx = text.indexOf('\n', idx + 1);
  }
  return starts;
}

/** 1-based line number containing `offset`, via binary search over `lineStarts`. */
export function lineAt(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export interface FileMatchResult {
  matches: PatternMatch[];
  skippedLines: number;
}

/**
 * Find up to `limit` matches of `regex` in `source`.
 *
 * Lines longer than MAX_LINE_LENGTH are blanked before matching (line numbering
 * is preserved), so they can never match or feed catastrophic backtracking.
 * `onMatch` is invoked as each match is found so callers can stream results.
 */
export function matchSource(
  source: string,
  regex: RegExp,
  filePath: string,
  limit: number,
  onMatch?: (match: PatternMatch) => void,
): FileMatchResult {
  const lines = source.split('\n');
  let skippedLines = 0;
  const searchable = lines.map((line) => {
    if (line.length > MAX_LINE_LENGTH) {
      skippedLines++;
      return '';
    }
    return line;
  });
  const text = skippedLines > 0 ? searchable.join('\n') : source;
  const lineStarts = buildLineStarts(text);

  const matches: PatternMatch[] = [];
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let m: RegExpExecArray | null;
  while (matches.length < limit && (m = re.exec(text)) !== null) {
    if (m[0].length === 0) re.lastIndex++;
    const line = lineAt(lineStarts, m.index);
    const bindings: Record<string, string> = {};
    if (m.groups) {
      for (const [key, value] of Object.entries(m.groups)) bindings[key] = value;
    }
    // Context snippet: 2 lines before and 2 lines after (line is 1-based).
    const snippetStart = Math.max(0, line - 3);
    const snippetEnd = Math.min(lines.length, line + 2);
    const snippet = lines
      .slice(snippetStart, snippetEnd)
      .map((l) => (l.length > MAX_LINE_LENGTH ? `${l.slice(0, SNIPPET_LINE_PREVIEW)}…` : l))
      .join('\n');
    const match: PatternMatch = { filePath, line, snippet, bindings };
    matches.push(match);
    onMatch?.(match);
  }
  return { matches, skippedLines };
}
