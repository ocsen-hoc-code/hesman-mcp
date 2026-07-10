/**
 * Convert source code to compact mode by stripping comments,
 * collapsing blank lines, and removing trailing whitespace.
 * Preserves magic comments like // @ts-ignore, // eslint-disable-*.
 */
export function compactCode(source: string): string {
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
