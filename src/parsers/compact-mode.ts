import { type LanguageProfile } from './language-profile';

export interface CompactOptions {
  level?: 1 | 2;                     // 1 = basic regex (Phase 2), 2 = AST-aware
  removeUnusedImports?: boolean;      // remove unused named imports
  profile?: LanguageProfile;          // language profile (required for level 2 in future)
}

/**
 * Convert source code to compact mode by stripping comments,
 * collapsing blank lines, and removing trailing whitespace.
 * Preserves magic comments like // @ts-ignore, // eslint-disable-*.
 *
 * @param source  Source code to compact
 * @param options Optional level and import removal settings
 */
export function compactCode(source: string, options?: CompactOptions): string {
  const level = options?.level ?? 1;

  if (level === 1) {
    // Existing Phase 2 logic unchanged
    return compactCodeBasic(source);
  }

  // Level 2: AST-aware
  return compactCodeAST(source, options!);
}

function compactCodeBasic(source: string): string {
  const lines = source.split('\n');
  const result: string[] = [];
  let prevBlank = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Preserve magic comments
    if (isMagicComment(trimmed)) {
      result.push(trimmed);
      prevBlank = false;
      continue;
    }

    // Strip line comments (naive: // outside strings)
    const noLineComment = stripLineComment(trimmed);

    // Collapse blank lines
    if (noLineComment.length === 0) {
      if (!prevBlank) result.push('');
      prevBlank = true;
      continue;
    }

    result.push(noLineComment);
    prevBlank = false;
  }

  // Strip block comments from the joined result
  let output = result.join('\n');
  output = stripBlockComments(output);

  return output.trim() + '\n';
}

function compactCodeAST(source: string, options: CompactOptions): string {
  const lines = source.split('\n');
  const result: string[] = [];

  // Parse to identify JSDoc ranges and unused imports
  const jsdocRanges = findJSDocRanges(source);
  const unusedImports = options.removeUnusedImports ? findUnusedImports(source) : new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip lines of unused imports
    if (unusedImports.has(i + 1)) continue;

    // Check if this line is inside a JSDoc block
    const inJSDoc = jsdocRanges.some(([s, e]) => i + 1 >= s && i + 1 <= e);

    const trimmed = line.trimEnd();

    // Preserve JSDoc lines (including blank lines inside JSDoc)
    if (inJSDoc) {
      result.push(trimmed);
      continue;
    }

    // Preserve magic comments
    if (isMagicComment(trimmed)) {
      result.push(trimmed);
      continue;
    }

    // Strip single-line comments
    const noLineComment = stripLineComment(trimmed);

    // Skip entirely blank / comment-only lines (will be collapsed later)
    if (noLineComment.length === 0) {
      continue;
    }

    result.push(noLineComment);
  }

  let output = result.join('\n');

  // Strip non-JSDoc block comments
  output = stripBlockCommentsKeepJSDoc(output);

  // Collapse multiple consecutive blank lines into one
  output = output.replace(/\n{3,}/g, '\n\n');

  return output.trim() + '\n';
}

// Helper: find JSDoc ranges (/** ... */)
function findJSDocRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\/\*\*[\s\S]*?\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const startLine = source.substring(0, m.index).split('\n').length;
    const endLine = source.substring(0, m.index + m[0].length).split('\n').length;
    ranges.push([startLine, endLine]);
  }
  return ranges;
}

// Helper: find unused imports (naive: imported name not found in rest of file)
function findUnusedImports(source: string): Set<number> {
  const unused = new Set<number>();
  const importRe = /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source)) !== null) {
    const names = m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());
    const afterImport = source.substring(m.index + m[0].length);
    for (const name of names) {
      if (!new RegExp(`\\b${name}\\b`).test(afterImport)) {
        unused.add(source.substring(0, m.index).split('\n').length);
      }
    }
  }
  return unused;
}

// Helper: strip block comments but keep JSDoc
function stripBlockCommentsKeepJSDoc(source: string): string {
  return source.replace(/\/\*[^*][\s\S]*?\*\//g, (match) => {
    if (match.startsWith('/**')) return match; // Keep JSDoc
    return ''; // Remove non-JSDoc block comments
  });
}

function isMagicComment(line: string): boolean {
  return /\s*\/\/\s*(?:@(?:ts-ignore|ts-expect-error|ts-nocheck)|eslint(?:-disable|-enable)(?:-next-line)?)/.test(line);
}

function stripLineComment(line: string): string {
  // Find // not inside a string
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    if (line[i] === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    if (line[i] === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;

    if (!inSingle && !inDouble && !inBacktick && line[i] === '/' && line[i + 1] === '/') {
      return line.substring(0, i).trimEnd();
    }
  }
  return line;
}

function stripBlockComments(source: string): string {
  let result = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  while (i < source.length) {
    // Track string state
    const ch = source[i];
    if (ch === '\\') { result += ch; i++; if (i < source.length) result += source[i]; i++; continue; }
    if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    if (ch === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;

    // Block comment start (outside strings)
    if (!inSingle && !inDouble && !inBacktick && ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        i++;
      }
      i += 2; // skip */
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}
