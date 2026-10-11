/**
 * Generic symbol extraction driven by Tree-sitter `tags.scm` queries.
 *
 * Most grammars ship a `queries/tags.scm` that follows one convention:
 * `@definition.<suffix>` marks a definition node, `@reference.<suffix>` marks a
 * reference, and `@name` marks the identifier inside either. This module runs
 * such queries and turns the matches into definitions and references, so a
 * language needs a grammar and a query file instead of hand-written code.
 *
 * Nothing here knows about a specific language. Language-specific behavior
 * lives in the query files (`queries/<lang>/`) and, as a documented exception,
 * in the override hooks of a `LanguageProfile`.
 */
import { Query, type Language, type Node } from 'web-tree-sitter';
import { kindForTagSuffix } from './symbol-kinds.js';

const DEFINITION_PREFIX = 'definition.';
const REFERENCE_PREFIX = 'reference.';
const NAME_CAPTURE = 'name';

/** Signatures longer than this are cut (one very long line would bloat every response). */
export const MAX_SIGNATURE_LENGTH = 200;

/** One query file (or inline query) of a language. Layers are applied in order. */
export interface TagsQueryLayer {
  /** Shown in error messages and reported on each definition, e.g. `go/tags.scm`. */
  name: string;
  /** The query text. */
  source: string;
}

/** A `@definition.<suffix>` match. Nodes are only valid until their tree is deleted. */
export interface TagDefinition {
  name: string;
  /** The capture suffix as written in the query (`function`, `class`, ...). */
  suffix: string;
  /** The Hesman kind the suffix maps to (`unknown` for an unmapped suffix). */
  kind: string;
  /** The whole definition node. */
  node: Node;
  /** The identifier node captured as `@name`. */
  nameNode: Node;
  /** Name of the layer whose pattern produced this definition. */
  layer: string;
}

/** A `@reference.<suffix>` match, positioned at its `@name`. */
export interface TagReference {
  name: string;
  /** The capture suffix as written in the query (`call`, `type`, `class`, ...). */
  suffix: string;
  /** 1-based line of the name. */
  line: number;
  /** 0-based column of the name. */
  col: number;
}

/**
 * Splits query text into its top-level patterns. A pattern is one balanced
 * `( ... )` or `[ ... ]` form plus whatever follows it up to the next form
 * (captures and quantifiers such as `(type_identifier) @name @reference.type`).
 * Comments and string literals are skipped, so brackets inside them do not count.
 */
export function splitPatterns(source: string): string[] {
  const patterns: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === ';') {
      const eol = source.indexOf('\n', i);
      i = eol === -1 ? source.length : eol;
    } else if (ch === '"') {
      for (i++; i < source.length && source[i] !== '"'; i++) {
        if (source[i] === '\\') i++;
      }
    } else if (ch === '(' || ch === '[') {
      if (depth === 0) {
        if (start !== -1) patterns.push(source.slice(start, i));
        start = i;
      }
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    }
  }
  if (start !== -1) patterns.push(source.slice(start));
  return patterns;
}

interface CompiledPatterns {
  query: Query;
  /** Layer name of each pattern, by pattern index. */
  layerOf: string[];
}

/**
 * The compiled tags queries of one language.
 *
 * Build it once per language and reuse it for every file: compiling is far
 * more expensive than running. Call `delete()` to release the WASM memory.
 *
 * Layering: every layer contributes its patterns, in order. When two patterns
 * tag the same `@name` node, the earliest one wins. Upstream queries are listed
 * first and Hesman's gap-filling queries last, so a gap filler adds what
 * upstream misses and never changes what upstream already tags.
 */
export class TagsQuery {
  private readonly language: Language;
  private readonly definitionPatterns: Array<{ layer: string; text: string }> = [];
  private readonly referencePatterns: Array<{ layer: string; text: string }> = [];
  private definitionQuery: CompiledPatterns | null = null;
  private referenceQuery: CompiledPatterns | null = null;

  constructor(language: Language, layers: readonly TagsQueryLayer[]) {
    this.language = language;
    for (const layer of layers) {
      const patterns = splitPatterns(layer.source);
      this.validate(layer, patterns.length);
      for (const text of patterns) {
        // A pattern with only `@name` (upstream Go has some) tags nothing and is dropped.
        if (text.includes(`@${DEFINITION_PREFIX}`)) this.definitionPatterns.push({ layer: layer.name, text });
        if (text.includes(`@${REFERENCE_PREFIX}`)) this.referencePatterns.push({ layer: layer.name, text });
      }
    }
    // Definitions are needed for every file; references are compiled on first use.
    this.definitionQuery = this.compile(this.definitionPatterns);
  }

  /**
   * Compiles one layer by itself, so that a query that does not fit the grammar
   * is reported with its file name, and checks that `splitPatterns` saw the
   * same patterns as Tree-sitter (pattern indexes are mapped back to layers).
   */
  private validate(layer: TagsQueryLayer, expectedPatterns: number): void {
    let query: Query;
    try {
      query = new Query(this.language, layer.source);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Tags query ${layer.name} does not compile for this grammar: ${reason}`);
    }
    const actual = query.patternCount();
    query.delete();
    if (actual !== expectedPatterns) {
      throw new Error(
        `Tags query ${layer.name}: found ${expectedPatterns} top-level patterns, Tree-sitter compiled ${actual}`,
      );
    }
  }

  private compile(patterns: Array<{ layer: string; text: string }>): CompiledPatterns {
    const query = new Query(this.language, patterns.map((p) => p.text).join('\n'));
    return { query, layerOf: patterns.map((p) => p.layer) };
  }

  /**
   * Definitions under `root`, in document order (an enclosing definition comes
   * before the definitions inside it). Matches without a `@name` are skipped.
   */
  definitions(root: Node): TagDefinition[] {
    const compiled = this.definitionQuery;
    if (!compiled) throw new Error('TagsQuery used after delete()');

    // name node id → winning match (lowest pattern index = earliest layer).
    const byName = new Map<number, { pattern: number; definition: TagDefinition }>();
    for (const match of compiled.query.matches(root)) {
      let node: Node | undefined;
      let nameNode: Node | undefined;
      let suffix = '';
      for (const capture of match.captures) {
        if (capture.name === NAME_CAPTURE) {
          nameNode ??= capture.node;
        } else if (!node && capture.name.startsWith(DEFINITION_PREFIX)) {
          node = capture.node;
          suffix = capture.name.slice(DEFINITION_PREFIX.length);
        }
      }
      if (!node || !nameNode) continue;

      const existing = byName.get(nameNode.id);
      if (existing && existing.pattern <= match.patternIndex) continue;
      byName.set(nameNode.id, {
        pattern: match.patternIndex,
        definition: {
          name: nameNode.text,
          suffix,
          kind: kindForTagSuffix(suffix),
          node,
          nameNode,
          layer: compiled.layerOf[match.patternIndex],
        },
      });
    }

    return [...byName.values()]
      .map((entry) => entry.definition)
      .sort(
        (a, b) =>
          a.node.startIndex - b.node.startIndex ||
          b.node.endIndex - a.node.endIndex ||
          a.nameNode.startIndex - b.nameNode.startIndex,
      );
  }

  /**
   * References under `root`, in document order. The name of a definition is
   * not a reference to itself, even when a broad pattern such as
   * `(type_identifier) @name @reference.type` also matches it.
   */
  references(root: Node): TagReference[] {
    if (!this.definitionQuery) throw new Error('TagsQuery used after delete()');
    this.referenceQuery ??= this.compile(this.referencePatterns);

    const definitionNames = new Set(this.definitions(root).map((d) => d.nameNode.id));
    const seen = new Set<string>();
    const found: Array<{ index: number; reference: TagReference }> = [];
    for (const match of this.referenceQuery.query.matches(root)) {
      let nameNode: Node | undefined;
      let suffix: string | undefined;
      for (const capture of match.captures) {
        if (capture.name === NAME_CAPTURE) nameNode ??= capture.node;
        else if (suffix === undefined && capture.name.startsWith(REFERENCE_PREFIX)) {
          suffix = capture.name.slice(REFERENCE_PREFIX.length);
        }
      }
      if (!nameNode || suffix === undefined || definitionNames.has(nameNode.id)) continue;
      const key = `${nameNode.id}:${suffix}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        index: nameNode.startIndex,
        reference: {
          name: nameNode.text,
          suffix,
          line: nameNode.startPosition.row + 1,
          col: nameNode.startPosition.column,
        },
      });
    }
    return found.sort((a, b) => a.index - b.index).map((f) => f.reference);
  }

  /** Releases the compiled queries. The instance must not be used afterwards. */
  delete(): void {
    this.definitionQuery?.query.delete();
    this.referenceQuery?.query.delete();
    this.definitionQuery = null;
    this.referenceQuery = null;
  }
}

/**
 * Signature of a definition, for any language: the first line of the node,
 * without its body and without a trailing block opener (`{` or `:`), trimmed
 * and capped at `MAX_SIGNATURE_LENGTH` characters.
 *
 * The body is recognized by the grammar's `body` field, which most grammars
 * use for function, class and interface bodies; a one-line definition such as
 * `func f() int { return 1 }` therefore yields `func f() int`.
 */
export function signatureOf(node: Node, source: string): string {
  const body = node.childForFieldName('body');
  const end = body && body.startIndex > node.startIndex ? body.startIndex : node.endIndex;
  const header = source.slice(node.startIndex, end);
  const firstLine = header.split('\n', 1)[0].trim();
  return firstLine.replace(/\s*[{:]$/, '').trimEnd().slice(0, MAX_SIGNATURE_LENGTH);
}

/** Comment delimiters at the start of a comment line: C-style blocks, `//`, `#`, `--`, `;`. */
const COMMENT_LINE_START = /^(?:\/\*+!?|\/\/[/!]?|\*+(?!\/)|#+!?|--+|;+)\s?/;
const COMMENT_BLOCK_END = /\s*\*+\/$/;

function stripCommentDelimiters(text: string): string[] {
  return text.split('\n').map((line) => line.trim().replace(COMMENT_BLOCK_END, '').replace(COMMENT_LINE_START, '').trimEnd());
}

function isComment(node: Node): boolean {
  return node.type.includes('comment');
}

/** True if only whitespace precedes `node` on its line (it is not a trailing comment). */
function startsItsLine(node: Node, source: string): boolean {
  for (let i = node.startIndex - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === '\n') return true;
    if (ch !== ' ' && ch !== '\t' && ch !== '\r') return false;
  }
  return true;
}

/**
 * Doc comment of a definition, for any language: the contiguous comment nodes
 * (node type contains `comment`) directly above it, with no blank line in
 * between, comment delimiters removed. Returns null when there is none.
 *
 * A definition is often the first thing inside a wrapper that starts on the
 * same line (`export function f`, Go `type T struct`, `const x = 1`); the
 * comment then sits above the wrapper, so the search starts from the outermost
 * such wrapper.
 */
export function docCommentAbove(node: Node, source: string): string | null {
  let anchor = node;
  for (;;) {
    const parent = anchor.parent;
    if (!parent || !parent.parent) break;
    if (anchor.previousNamedSibling || parent.startPosition.row !== anchor.startPosition.row) break;
    anchor = parent;
  }

  const comments: Node[] = [];
  let below = anchor;
  for (let prev = anchor.previousNamedSibling; prev && isComment(prev); prev = prev.previousNamedSibling) {
    if (prev.endPosition.row < below.startPosition.row - 1) break;
    if (!startsItsLine(prev, source)) break;
    comments.unshift(prev);
    below = prev;
  }
  if (comments.length === 0) return null;

  const lines = comments.flatMap((c) => stripCommentDelimiters(source.slice(c.startIndex, c.endIndex)));
  const doc = lines.join('\n').trim();
  return doc.length > 0 ? doc : null;
}
