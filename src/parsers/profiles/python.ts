import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { LanguageProfile, RelationQueries } from '../language-profile.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Python convention: a name is public unless it starts with `_`; dunder names
 * (`__init__`) are public protocol methods. Functions and classes defined
 * inside a function body are local and never exported.
 */
export function isPythonExported(name: string, node: SyntaxNode): boolean {
  const isDunder = name.length > 4 && name.startsWith('__') && name.endsWith('__');
  if (name.startsWith('_') && !isDunder) return false;
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'function_definition') return false;
  }
  return true;
}

/** Optional string prefix (`r`, `b`, `f`, `Rb`, ...) followed by the opening quotes. */
const STRING_OPENING = /^[A-Za-z]*("""|'''|"|')/;

/**
 * Override hook (reason): Python documents a function or class with a
 * docstring, the first statement *inside* its body, not with comments above
 * it, so the generic "comments directly above" helper cannot find it. Returns
 * null when there is no docstring; the generic helper then looks for `#`
 * comments above the definition.
 */
export function pythonDocstring(node: SyntaxNode, source: string): string | null {
  const first = node.childForFieldName('body')?.firstNamedChild;
  if (first?.type !== 'expression_statement') return null;
  const literal = first.firstNamedChild;
  if (literal?.type !== 'string') return null;

  let text = source.slice(literal.startIndex, literal.endIndex);
  const opening = STRING_OPENING.exec(text);
  if (!opening) return null;
  const quote = opening[1];
  text = text.slice(opening[0].length);
  if (text.endsWith(quote)) text = text.slice(0, -quote.length);

  const doc = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  return doc.length > 0 ? doc : null;
}

export const pythonProfile: LanguageProfile = {
  language: 'python',
  extensions: ['.py', '.pyw', '.pyi'],

  // Path relative to the parsers/ directory in project root
  get parserWasmPath(): string {
    return join(__dirname, '..', '..', '..', 'parsers', 'tree-sitter-python.wasm');
  },

  relationQueries: {
    calls: `
      (call function: (identifier) @callee) @call_site
    `,
    imports: `
      (import_statement name: (dotted_name) @module_path)
      (import_from_statement module_name: (dotted_name) @module_path)
    `,
    extends: `
      (class_definition
        name: (identifier) @class
        superclasses: (argument_list (identifier) @parent))
    `,
  } as RelationQueries,

  isExported: isPythonExported,

  extractDocComment: pythonDocstring,
};
