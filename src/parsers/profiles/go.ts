import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { LanguageProfile, RelationQueries } from '../language-profile.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Node types whose bodies introduce a function-local scope. */
const GO_FUNCTION_SCOPES = new Set(['function_declaration', 'method_declaration', 'func_literal']);

/**
 * Go spec: an identifier is exported iff its first character is a Unicode
 * uppercase letter (Lu) and it is declared at package level (or is a method /
 * field name). Declarations inside a function body are never exported.
 */
export function isGoExported(name: string, node: SyntaxNode): boolean {
  if (!/^\p{Lu}/u.test(name)) return false;
  for (let p = node.parent; p; p = p.parent) {
    if (GO_FUNCTION_SCOPES.has(p.type)) return false;
  }
  return true;
}

export const goProfile: LanguageProfile = {
  language: 'go',
  extensions: ['.go'],

  // Path relative to the parsers/ directory in project root
  get parserWasmPath(): string {
    return join(__dirname, '..', '..', '..', 'parsers', 'tree-sitter-go.wasm');
  },

  relationQueries: {
    calls: `
      (call_expression
        function: (identifier) @callee) @call_site
    `,
    imports: `
      (import_spec
        (interpreted_string_literal
          (interpreted_string_literal_content) @module_path))
    `,
  } as RelationQueries,

  isExported: isGoExported,
};
