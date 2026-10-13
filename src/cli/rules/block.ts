/**
 * The guidance block `hesman setup --rules` writes into a project's agent instruction files, and
 * the pure text operations that add, replace and remove it. Nothing here touches the file system.
 */

/** First and last line of the block. Everything between them belongs to Hesman; nothing else does. */
export const RULES_START = '<!-- hesman:rules:start -->';
export const RULES_END = '<!-- hesman:rules:end -->';

/**
 * The single source of the guidance text. Keep it at most 15 lines with the markers, free of
 * savings claims, and true for the tools in `src/server/tools/` (see `docs/TOOLS.md`); the unit
 * test checks the length and that every tool named here is registered by the server.
 */
export const RULES_BLOCK = [
  RULES_START,
  '## Code navigation with Hesman (MCP)',
  '',
  'When the `hesman` MCP server is connected, use its tools for questions about code instead of grep or reading whole files:',
  '',
  '- Where is X defined? `find_symbol` (by name), or `get_file_structure` for the outline of one file, before opening the file.',
  '- Reading code: `get_context` with `filePath`, `startLine` and `endLine` returns only those lines plus a few around them. Line numbers are 1-based everywhere.',
  '- Who uses or calls X, and what does X call? `get_references`, `get_callers`, `get_callees`; pass the `id` from `find_symbol` as `symbolId`.',
  '- What breaks if X is renamed, deleted or gets a new signature? `impact_analysis`.',
  '- Code by meaning, when the name is unknown: `semantic_search`. Code by pattern, such as `console.$METHOD($$$ARGS)`: `find_pattern`. Imports of a file: `list_dependencies`.',
  '- List results (`find_symbol`, `get_references`, `get_callers`, `get_callees`, `get_file_structure`, `list_dependencies`, `impact_analysis`) are compact by default: rows are arrays under the named `columns`, grouped under `files` (or one `rows` list), with project-relative paths. `format: "full"` returns one object per row.',
  '- A result marked `precision: "text"` is a line range of a file without a parser, not a symbol: read it with `get_context` and do not pass its `symbolId` to other tools.',
  '- If results look incomplete or a response carries `_meta.indexing`, call `index_status`: the index may still be building, or the language may not be parsed. A `note` on an empty call or reference list means that language has no call graph (symbols only), not that X is unused.',
  '- Relations are matched by name, not compiler-checked: confirm with `get_context` before a risky change, and use grep for exact strings.',
  RULES_END,
].join('\n');

const NEWLINE = /^\r?\n/;

interface Located {
  /** Text before the start marker. */
  before: string;
  /** Text after the end marker (starting with the line break that ends the marker line, if any). */
  after: string;
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Finds the block. Undefined when there is none; throws when the markers are not one clean pair. */
function locate(text: string): Located | undefined {
  const starts = occurrences(text, RULES_START);
  const ends = occurrences(text, RULES_END);
  if (starts === 0 && ends === 0) return undefined;
  const start = text.indexOf(RULES_START);
  const end = text.indexOf(RULES_END);
  if (starts !== 1 || ends !== 1 || end < start) {
    throw new Error(
      `the Hesman rules markers are damaged (expected one "${RULES_START}" followed by one "${RULES_END}"); fix or delete them by hand`,
    );
  }
  return { before: text.slice(0, start), after: text.slice(end + RULES_END.length) };
}

export function hasRulesBlock(text: string): boolean {
  return locate(text) !== undefined;
}

/**
 * `original` with the current block in it. An existing block is replaced where it stands;
 * otherwise the block is appended after one blank line, in the file's own line endings.
 * `original` is `undefined` for a file that does not exist; such a file starts with `header`
 * (front matter of a rule file Hesman owns), which is never added to an existing file.
 *
 * The line break after the end marker records how the file ended before: present when the file
 * ended with a line break or did not exist, absent otherwise. {@link stripRulesBlock} relies on
 * that to give back the original bytes.
 */
export function upsertRulesBlock(original: string | undefined, header = ''): string {
  if (original === undefined) return `${header}${header ? '\n' : ''}${RULES_BLOCK}\n`;

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const block = RULES_BLOCK.replace(/\n/g, eol);
  const found = locate(original);
  if (found) return found.before + block + found.after;
  if (original === '') return block;
  return /\n$/.test(original) ? original + eol + block + eol : original + eol + eol + block;
}

/**
 * `text` without the block and without the blank line that separated it, or `undefined` when
 * nothing but the block (and `header`) is left, which means Hesman created the file and it should
 * be deleted. Text without a block is returned as it is.
 */
export function stripRulesBlock(text: string, header = ''): string | undefined {
  const found = locate(text);
  if (!found) return text;
  const { before, after } = found;

  if (!NEWLINE.test(after)) {
    // The block ends the file without a line break: the file had no final line break before.
    return before.replace(/(\r?\n){2}$/, '') + after;
  }
  // Drop the line break of the end marker line and the blank line that was put before the block.
  const rest = before.replace(/(\r?\n)\r?\n$/, '$1') + after.replace(NEWLINE, '');
  return rest === header ? undefined : rest;
}
