import type { LanguageProfile, RelationQueries } from '../language-profile.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const goProfile: LanguageProfile = {
  language: 'go',
  extensions: ['.go'],

  // Path relative to the parsers/ directory in project root
  get parserWasmPath(): string {
    return join(__dirname, '..', '..', '..', 'parsers', 'tree-sitter-go.wasm');
  },

  symbolNodeTypes: new Set([
    'function_declaration',
    'method_declaration',
    'type_spec',
    'const_spec',
    'var_spec',
  ]),

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

  extractSignature(nodeText: string, _sourceText: string): string {
    // Return the first line of the node text (the declaration line)
    const firstLine = nodeText.split('\n')[0].trim();
    // Truncate at first '{' for function/method/struct bodies
    const braceIdx = firstLine.indexOf('{');
    if (braceIdx > 0) return firstLine.slice(0, braceIdx).trim();
    return firstLine;
  },

  extractDocComment(nodeStartLine: number, sourceLines: string[]): string | null {
    // Go doc comments are // lines immediately before the declaration,
    // with no blank line separating them from the declaration.
    const comments: string[] = [];
    let i = nodeStartLine - 1;

    // Walk backwards collecting comment lines until a non-comment line is hit
    while (i >= 0) {
      const line = sourceLines[i].trim();
      if (line.startsWith('//')) {
        comments.unshift(line);
        i--;
      } else {
        break;
      }
    }

    // Also check for /* */ block comments
    if (comments.length === 0 && i >= 0) {
      if (sourceLines[i].trim().endsWith('*/')) {
        const blockLines: string[] = [];
        blockLines.unshift(sourceLines[i].trim());
        while (i > 0) {
          i--;
          const prev = sourceLines[i].trim();
          blockLines.unshift(prev);
          if (prev.startsWith('/*') || prev.startsWith('/**')) break;
        }
        return blockLines.join('\n');
      }
    }

    if (comments.length === 0) return null;

    // Strip // prefix and optional leading space
    return comments
      .map((c) => {
        const s = c.trim();
        if (s === '//') return '';
        return s.replace(/^\/\/\s?/, '');
      })
      .join('\n')
      .trim();
  },
};
