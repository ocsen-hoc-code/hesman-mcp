import type { SyntaxNode } from 'web-tree-sitter';

export interface RelationQueries {
  /** Tree-sitter query string to extract call expressions */
  calls?: string;
  /** Tree-sitter query string to extract extends clauses */
  extends?: string;
  /** Tree-sitter query string to extract implements clauses */
  implements?: string;
  /** Tree-sitter query string to extract import statements */
  imports?: string;
  /** Tree-sitter query string to extract type references */
  references?: string;
}

export interface LanguageProfile {
  /** Language identifier: "typescript", "python", "go", ... */
  language: string;
  /** File extensions for this language (with dot) */
  extensions: string[];
  /** Path to the tree-sitter WASM parser file */
  parserWasmPath: string;
  /** Set of tree-sitter node type names that qualify as symbols */
  symbolNodeTypes: Set<string>;
  /** Optional relation extraction queries. If absent, relations are not extracted. */
  relationQueries?: RelationQueries;
  /**
   * Extract a human-readable signature from a symbol node.
   * @param nodeText - the full text of the AST node
   * @param sourceText - the full file source (for context)
   */
  extractSignature(nodeText: string, sourceText: string): string;
  /**
   * Extract a doc comment preceding the symbol node, or null.
   * @param nodeStartLine - the 0-indexed line where the symbol node starts
   * @param sourceLines - the full file source split into lines
   */
  extractDocComment(nodeStartLine: number, sourceLines: string[]): string | null;
  /**
   * Decide whether a named symbol is visible outside its module/package,
   * using the language's own rules. When absent, a symbol is exported iff it
   * sits inside an `export_statement` (TypeScript/JavaScript semantics).
   * @param name - the symbol's identifier
   * @param node - the declaration node
   */
  isExported?(name: string, node: SyntaxNode): boolean;
}
