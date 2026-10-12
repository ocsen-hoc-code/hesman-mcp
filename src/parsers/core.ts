import { Parser, Language, type Node as SyntaxNode } from 'web-tree-sitter';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LanguageProfile } from './language-profile.js';
import { languageById, tagsQueryFiles, QUERIES_DIR } from './languages.js';
import { grammarSourceFor } from './grammar-store.js';
import { TagsQuery, ignoredRangesAt, signatureOf, docCommentAbove, type OffsetRange } from './tags-engine.js';
import { callSiteOffsets } from './relation-extractor.js';
import { isEcmaScriptExported, isPropertyAssigned } from './ecmascript.js';
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
  /**
   * 1 for a function that is the value of an object key or is assigned to a
   * property; the call resolver links such a function in its own file only.
   */
  is_property?: number;
}

export interface ParseResult {
  symbols: ExtractedSymbol[];
  /**
   * Source ranges that cannot hold a call (string and comment text,
   * signature-only declarations), sorted and non-overlapping. Pass them to
   * `extractRelations`; empty for a language without relation extraction.
   */
  ignoredRanges: OffsetRange[];
  language: string;
  parseQuality: 'full' | 'partial';
  errors: Array<{ line: number; message: string }>;
}

/** Everything needed to parse one language: created once, reused for every file. */
interface LanguageRuntime {
  parser: Parser;
  /** Compiled tags queries, or null for a language that has no tags query. */
  tags: TagsQuery | null;
}

let parserInitialized = false;
/**
 * One loaded grammar, one `Parser` and one compiled `TagsQuery` per language,
 * created on first use and kept for the life of the process (or worker
 * thread). A parser is reused for every file of its language: creating one
 * per file leaked WASM memory, since parsers are only freed by an explicit
 * `delete()`. Queries are compiled once because compiling costs far more than
 * running them.
 */
const runtimeCache = new Map<string, Promise<LanguageRuntime>>();

export async function initParser(profile: LanguageProfile): Promise<void> {
  if (parserInitialized) return;
  await Parser.init();
  log.info({ language: profile.language }, 'tree-sitter parser initialized');
  parserInitialized = true;
}

async function createRuntime(profile: LanguageProfile): Promise<LanguageRuntime> {
  // A bundled grammar is loaded from `parsers/`; an on-demand one from the bytes of the cached file, hashed again first.
  const language = await Language.load(grammarSourceFor(profile));
  const parser = new Parser();
  parser.setLanguage(language);

  const definition = languageById(profile.language);
  const files = definition ? tagsQueryFiles(definition) : [];
  const tags =
    files.length > 0
      ? new TagsQuery(
          language,
          files.map((file) => ({ name: file.slice(QUERIES_DIR.length + 1), source: readFileSync(file, 'utf-8') })),
        )
      : null;
  return { parser, tags };
}

function runtimeFor(profile: LanguageProfile): Promise<LanguageRuntime> {
  let pending = runtimeCache.get(profile.language);
  if (!pending) {
    pending = createRuntime(profile);
    runtimeCache.set(profile.language, pending);
    // A failed load must not poison the cache: the next file retries.
    pending.catch(() => runtimeCache.delete(profile.language));
  }
  return pending;
}

export async function parseFile(
  filePath: string,
  profile: LanguageProfile,
): Promise<ParseResult> {
  await initParser(profile);

  const source = readFileSync(filePath, 'utf-8');
  const { parser, tags } = await runtimeFor(profile);

  // Everything from here to `tree.delete()` is synchronous, so concurrent
  // `parseFile` calls never interleave on the shared parser.
  const tree = parser.parse(source);
  if (!tree) throw new Error(`tree-sitter returned no syntax tree for ${filePath}`);
  try {
    // hasError is a boolean property on the node, not a method
    const hasError = tree.rootNode.hasError;

    const symbols = tags ? extractSymbols(tree.rootNode, source, filePath, profile, tags) : [];
    const errors: Array<{ line: number; message: string }> = [];
    if (hasError) {
      collectErrorNodes(tree.rootNode, source, errors);
    }

    return {
      symbols,
      ignoredRanges: profile.relationQueries ? ignoredRangesAt(tree.rootNode, callSiteOffsets(source)) : [],
      language: profile.language,
      parseQuality: hasError ? 'partial' : 'full',
      errors,
    };
  } finally {
    // Trees live in WASM memory and are never garbage collected.
    tree.delete();
  }
}

/** Kinds whose members get a `parent_id` pointing back at them. */
const CONTAINER_KINDS = new Set(['class', 'interface', 'namespace']);

/**
 * Turns the definitions found by the language's tags queries into symbols.
 * Language-specific behavior is limited to the profile hooks: export rules,
 * and the documented `includeDefinition` / `extractDocComment` overrides.
 */
function extractSymbols(
  root: SyntaxNode,
  source: string,
  filePath: string,
  profile: LanguageProfile,
  tags: TagsQuery,
): ExtractedSymbol[] {
  const results: ExtractedSymbol[] = [];
  // Enclosing containers of the current definition, outermost first.
  // Definitions arrive in document order, an outer one before its members.
  const containers: Array<{ id: string; endIndex: number }> = [];

  for (const definition of tags.definitions(root)) {
    if (profile.includeDefinition && !profile.includeDefinition(definition)) continue;
    const { name, kind, node } = definition;

    while (containers.length > 0 && containers[containers.length - 1].endIndex <= node.startIndex) {
      containers.pop();
    }

    // Tree-sitter rows are 0-based; stored lines are 1-based, inclusive.
    const startLine = node.startPosition.row + 1;
    const id = makeSymbolId(filePath, name, kind, startLine);

    results.push({
      id,
      name,
      kind,
      file_path: filePath,
      start_line: startLine,
      end_line: node.endPosition.row + 1,
      start_col: node.startPosition.column,
      end_col: node.endPosition.column,
      signature: signatureOf(node, source),
      doc_comment: profile.extractDocComment?.(node, source) ?? docCommentAbove(node, source),
      parent_id: containers.length > 0 ? containers[containers.length - 1].id : null,
      language: profile.language,
      is_exported: (profile.isExported ? profile.isExported(name, node) : isEcmaScriptExported(name, node)) ? 1 : 0,
      is_property: kind === 'function' && isPropertyAssigned(node) ? 1 : 0,
    });

    if (CONTAINER_KINDS.has(kind)) containers.push({ id, endIndex: node.endIndex });
  }

  return results;
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
