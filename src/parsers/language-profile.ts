import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { TagDefinition } from './tags-engine.js';

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

/**
 * What Hesman needs to know about a language beyond its grammar and its tags
 * queries (both declared in the registry, `languages.ts`).
 *
 * Symbols, signatures and doc comments come from the generic tags engine
 * (`tags-engine.ts`). The optional hooks below are escape hatches for what a
 * query cannot express; every use must state its reason in the profile file.
 */
export interface LanguageProfile {
  /** Language identifier: "typescript", "python", "go", ... */
  language: string;
  /** File extensions for this language (with dot) */
  extensions: string[];
  /** Path to the tree-sitter WASM parser file */
  parserWasmPath: string;
  /**
   * Marks a language whose relations are extracted (registry tier `deep`); if
   * absent, no relation is stored. Only its presence matters: calls and
   * imports come from the `@reference.call` / `@reference.import` patterns of
   * the language's query layers (`TagsQuery.relations`), not from the strings
   * in this object.
   */
  relationQueries?: RelationQueries;
  /**
   * Decide whether a named symbol is visible outside its module/package,
   * using the language's own rules. When absent, a symbol is exported iff it
   * sits inside an `export_statement` (TypeScript/JavaScript semantics).
   * @param name - the symbol's identifier
   * @param node - the declaration node
   */
  isExported?(name: string, node: SyntaxNode): boolean;
  /**
   * Override hook: return false to drop a definition the tags queries found.
   * Only for cases a vendored upstream query cannot be changed to express.
   */
  includeDefinition?(definition: TagDefinition): boolean;
  /**
   * Override hook: the doc comment of a definition when the language does not
   * document with comments above it. Return null to fall back to the generic
   * helper (contiguous comments directly above the definition).
   * @param node - the definition node
   * @param source - the full file source
   */
  extractDocComment?(node: SyntaxNode, source: string): string | null;
}
