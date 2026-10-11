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

export const pythonProfile: LanguageProfile = {
  language: 'python',
  extensions: ['.py', '.pyw', '.pyi'],

  // Path relative to the parsers/ directory in project root
  get parserWasmPath(): string {
    return join(__dirname, '..', '..', '..', 'parsers', 'tree-sitter-python.wasm');
  },

  symbolNodeTypes: new Set([
    'function_definition',
    'class_definition',
    'decorated_definition',
  ]),

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

  extractSignature(nodeText: string, _sourceText: string): string {
    const lines = nodeText.split('\n');

    // For decorated_definition, skip decorator lines (@dataclass, @property, etc.)
    // and find the actual definition line
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('class ') ||
        trimmed.startsWith('def ') ||
        trimmed.startsWith('async ')
      ) {
        // Remove trailing colon from the signature
        const sig = trimmed.endsWith(':') ? trimmed.slice(0, -1).trim() : trimmed.trim();
        return sig;
      }
    }

    // Fallback: first non-empty line (skip decorators)
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('@')) {
        return trimmed.endsWith(':') ? trimmed.slice(0, -1).trim() : trimmed.trim();
      }
    }

    return lines[0].trim();
  },

  extractDocComment(nodeStartLine: number, sourceLines: string[]): string | null {
    // Python docstrings are the first string expression in a function/class body.
    // Look at lines after the function/class definition line.
    let lineIdx = nodeStartLine + 1;

    // Skip blank lines
    while (lineIdx < sourceLines.length && sourceLines[lineIdx].trim() === '') {
      lineIdx++;
    }

    if (lineIdx >= sourceLines.length) return null;

    const trimmed = sourceLines[lineIdx].trim();

    // Check for triple-quoted strings (""" or ''')
    if (trimmed.startsWith('"""')) {
      return extractTripleQuoted(trimmed, sourceLines, lineIdx, '"""');
    }

    if (trimmed.startsWith("'''")) {
      return extractTripleQuoted(trimmed, sourceLines, lineIdx, "'''");
    }

    return null;
  },
};

function extractTripleQuoted(
  firstLine: string,
  sourceLines: string[],
  startIdx: number,
  quote: string,
): string {
  const quoteLen = quote.length;

  // Single-line docstring: check if the closing quote is on the same line
  const closeIdx = firstLine.indexOf(quote, quoteLen);
  if (closeIdx >= 0) {
    return firstLine.slice(quoteLen, closeIdx).trim();
  }

  // Multi-line docstring: collect lines until the closing quote
  const docLines: string[] = [];
  // Content on the first line after the opening quotes
  docLines.push(firstLine.slice(quoteLen).trim());
  let i = startIdx + 1;
  while (i < sourceLines.length) {
    const current = sourceLines[i];
    const idx = current.indexOf(quote);
    if (idx >= 0) {
      docLines.push(current.slice(0, idx).trim());
      break;
    }
    docLines.push(current.trim());
    i++;
  }

  return docLines.filter(Boolean).join('\n').trim();
}
