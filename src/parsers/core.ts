import Parser, { type SyntaxNode } from 'web-tree-sitter';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LanguageProfile } from './language-profile.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('parser');

export interface ExtractedSymbol {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  start_col: number;
  end_col: number;
  signature: string | null;
  doc_comment: string | null;
  parent_id: string | null;
  language: string;
  is_exported: number;
}

export interface ParseResult {
  symbols: ExtractedSymbol[];
  language: string;
  parseQuality: 'full' | 'partial';
  errors: Array<{ line: number; message: string }>;
}

let parserInitialized = false;
const languageCache = new Map<string, Parser.Language>();

export async function initParser(profile: LanguageProfile): Promise<void> {
  if (parserInitialized) return;
  await Parser.init();
  log.info({ language: profile.language }, 'tree-sitter parser initialized');
  parserInitialized = true;
}

export async function parseFile(
  filePath: string,
  profile: LanguageProfile,
): Promise<ParseResult> {
  await initParser(profile);

  const source = readFileSync(filePath, 'utf-8');
  const parser = new Parser();
  let lang = languageCache.get(profile.language);
  if (!lang) {
    lang = await Parser.Language.load(profile.parserWasmPath);
    languageCache.set(profile.language, lang);
  }

  parser.setLanguage(lang);
  const tree = parser.parse(source);
  // hasError is a boolean property on SyntaxNode, not a method
  const hasError = tree.rootNode.hasError;

  const symbols = extractSymbols(tree.rootNode, source, filePath, profile);
  const errors: Array<{ line: number; message: string }> = [];
  if (hasError) {
    collectErrorNodes(tree.rootNode, source, errors);
  }

  return {
    symbols,
    language: profile.language,
    parseQuality: hasError ? 'partial' : 'full',
    errors,
  };
}

/**
 * Recursively walk the AST and extract symbols.
 *
 * Wrapper nodes (export_statement, lexical_declaration) are in symbolNodeTypes
 * but have no 'name' field. When a symbol-type node has no name we still recurse
 * into its children so that the real named declarations inside are found.
 */
function extractSymbols(
  node: SyntaxNode,
  source: string,
  filePath: string,
  profile: LanguageProfile,
  parentId: string | null = null,
): ExtractedSymbol[] {
  const results: ExtractedSymbol[] = [];
  const sourceLines = source.split('\n');

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (profile.symbolNodeTypes.has(child.type)) {
      const name = getSymbolName(child, source);

      if (name) {
        const kind = mapNodeTypeToKind(child.type);

        results.push({
          id: makeSymbolId(filePath, name, kind, child.startPosition.row + 1),
          name,
          kind,
          file_path: filePath,
          // Tree-sitter rows are 0-based; stored lines are 1-based, inclusive.
          start_line: child.startPosition.row + 1,
          end_line: child.endPosition.row + 1,
          start_col: child.startPosition.column,
          end_col: child.endPosition.column,
          signature: profile.extractSignature(
            source.slice(child.startIndex, child.endIndex),
            source,
          ),
          // 0-based on purpose: it indexes the `sourceLines` array.
          doc_comment: profile.extractDocComment(
            child.startPosition.row,
            sourceLines,
          ),
          parent_id: parentId,
          language: profile.language,
          is_exported: isNodeExported(child) ? 1 : 0,
        });

        // For classes / interfaces: recurse inside so methods / properties
        // are extracted with a parent_id linking back to the container.
        if (
          child.type === 'class_declaration' ||
          child.type === 'class_definition' ||
          child.type === 'interface_declaration'
        ) {
          const childId = makeSymbolId(
            filePath,
            name,
            kind,
            child.startPosition.row + 1,
          );
          const nested = extractSymbols(
            child,
            source,
            filePath,
            profile,
            childId,
          );
          results.push(...nested);
        } else {
          const nested = extractSymbols(
            child,
            source,
            filePath,
            profile,
            parentId,
          );
          results.push(...nested);
        }
      } else {
        // Symbol-type node with no name (e.g. export_statement,
        // lexical_declaration) — recurse into children so the real
        // named declarations (function_declaration, variable_declarator,
        // etc.) are found.
        const nested = extractSymbols(
          child,
          source,
          filePath,
          profile,
          parentId,
        );
        results.push(...nested);
      }
    } else {
      // Non-symbol node — recurse into children
      const nested = extractSymbols(
        child,
        source,
        filePath,
        profile,
        parentId,
      );
      results.push(...nested);
    }
  }

  return results;
}

function getSymbolName(node: SyntaxNode, source: string): string | null {
  // Most declaration nodes (function_declaration, class_declaration,
  // interface_declaration, type_alias_declaration, method_definition,
  // variable_declarator) expose a 'name' child field.
  const nameNode = node.childForFieldName('name');
  if (nameNode) return source.slice(nameNode.startIndex, nameNode.endIndex);

  // Fallback: for variable_declarator, the first child is the name
  if (node.type === 'variable_declarator' && node.childCount > 0) {
    const first = node.child(0);
    if (first) return source.slice(first.startIndex, first.endIndex);
  }

  return null;
}

function mapNodeTypeToKind(nodeType: string): string {
  const MAP: Record<string, string> = {
    // TypeScript / JavaScript
    function_declaration: 'function',
    generator_function_declaration: 'function',
    function_expression: 'function',
    arrow_function: 'function',
    class_declaration: 'class',
    method_definition: 'method',
    variable_declarator: 'variable',
    lexical_declaration: 'variable',
    interface_declaration: 'interface',
    type_alias_declaration: 'type',
    enum_declaration: 'enum',
    module_declaration: 'namespace',
    export_statement: 'variable',
    // Python
    function_definition: 'function',
    class_definition: 'class',
    decorated_definition: 'unknown',
    // Go
    method_declaration: 'method',
    type_spec: 'type',
    const_spec: 'constant',
    var_spec: 'variable',
  };
  return MAP[nodeType] || 'unknown';
}

function isNodeExported(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === 'export_statement') return true;
    current = current.parent;
  }
  return false;
}

/**
 * Collect ERROR nodes from the AST for partial parse reporting.
 */
function collectErrorNodes(
  node: SyntaxNode,
  source: string,
  errors: Array<{ line: number; message: string }>,
): void {
  if (node.type === 'ERROR') {
    const line = node.startPosition.row + 1; // 1-based like every stored line
    errors.push({
      line,
      message: `Unexpected token at line ${line}: ${source.slice(node.startIndex, node.endIndex).trim().slice(0, 80)}`,
    });
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectErrorNodes(child, source, errors);
  }
}

export function makeSymbolId(
  filePath: string,
  name: string,
  kind: string,
  startLine: number,
): string {
  const raw = `${filePath}:${name}:${kind}:${startLine}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}
