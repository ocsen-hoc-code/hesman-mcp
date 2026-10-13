import type { LanguageProfile, RelationQueries } from '../language-profile.js';
import type { TagDefinition } from '../tags-engine.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Declarations without a body: overload and ambient signatures, interface and abstract members. */
const BODYLESS_SIGNATURES = new Set(['function_signature', 'method_signature', 'abstract_method_signature']);

/**
 * Override hook (reason): the upstream TypeScript tags query also tags
 * body-less signatures as functions and methods. Such a signature shares its
 * name with the implementation (`interface Shape { area(): number }` next to
 * `class Circle { area() { ... } }`, or the overloads above a function), and
 * the call resolver (M0-13) refuses to link a call when two callables with
 * that name are in the same scope. Indexing them would therefore unlink calls
 * that resolve today. The vendored query stays unmodified, so they are dropped
 * here until the resolver can prefer implementations (M1-07).
 */
export function isTsImplementation(definition: TagDefinition): boolean {
  return !BODYLESS_SIGNATURES.has(definition.node.type);
}

const TS_RELATION_QUERIES: RelationQueries = {
  calls: `
    (call_expression
      function: (identifier) @callee) @call_site
  `,
  extends: `
    (class_declaration
      name: (type_identifier) @class
      heritage_clause: (extends_clause
        value: (type_identifier) @parent))
  `,
  implements: `
    (class_declaration
      name: (type_identifier) @class
      heritage_clause: (implements_clause
        value: (type_identifier) @iface))
  `,
  imports: `
    (import_statement
      source: (string (string_fragment) @module_path)
      import_clause: (import_clause
        (named_imports (import_specifier name: (identifier) @imported_name))?)?)
  `,
  references: `
    (type_annotation
      (type_identifier) @ref_type)
  `,
};

/** TypeScript and TSX share everything but the grammar (`.tsx` needs the JSX rules). */
function tsFlavor(language: string, extensions: string[], grammar: string): LanguageProfile {
  return {
    language,
    extensions,
    // Path relative to the parsers/ directory in project root
    parserWasmPath: join(__dirname, '..', '..', '..', 'parsers', grammar),
    relationQueries: TS_RELATION_QUERIES,
    includeDefinition: isTsImplementation,
  };
}

export const tsProfile = tsFlavor('typescript', ['.ts', '.mts', '.cts'], 'tree-sitter-typescript.wasm');

export const tsxProfile = tsFlavor('tsx', ['.tsx'], 'tree-sitter-tsx.wasm');
