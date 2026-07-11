import type { LanguageProfile } from '../language-profile.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const tsProfile: LanguageProfile = {
  language: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],

  // Path relative to the parsers/ directory in project root
  get parserWasmPath(): string {
    return join(__dirname, '..', '..', '..', 'parsers', 'tree-sitter-typescript.wasm');
  },

  symbolNodeTypes: new Set([
    'function_declaration',
    'generator_function_declaration',
    'class_declaration',
    'method_definition',
    'variable_declarator',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'module_declaration',
    'lexical_declaration',
    'export_statement',
    'function_expression',
    'arrow_function',
  ]),

  relationQueries: {
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
  },

  extractSignature(nodeText: string, _sourceText: string): string {
    // Return first line of the node text (the declaration line)
    const firstLine = nodeText.split('\n')[0].trim();
    // Truncate at first '{' for function/class bodies, keep the signature
    const braceIdx = firstLine.indexOf('{');
    if (braceIdx > 0) return firstLine.slice(0, braceIdx).trim();
    // For interfaces/types: return the full declaration
    return firstLine;
  },

  extractDocComment(nodeStartLine: number, sourceLines: string[]): string | null {
    // Walk backwards from nodeStartLine looking for /** ... */ or ///
    const comments: string[] = [];
    let i = nodeStartLine - 1;
    while (i >= 0) {
      const line = sourceLines[i].trim();
      if (line.endsWith('*/')) {
        // Found end of block comment — collect until start
        comments.unshift(line);
        while (i > 0) {
          i--;
          const prev = sourceLines[i].trim();
          comments.unshift(prev);
          if (prev.startsWith('/**') || prev.startsWith('/*')) break;
        }
        break;
      } else if (line.startsWith('///') || line.startsWith('//')) {
        comments.unshift(line);
        i--;
      } else {
        break;
      }
    }
    return comments.length > 0 ? comments.join('\n') : null;
  },
};
