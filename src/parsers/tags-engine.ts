/**
 * Generic symbol extraction driven by Tree-sitter `tags.scm` queries.
 *
 * Most grammars ship a `queries/tags.scm` that follows one convention:
 * `@definition.<suffix>` marks a definition node, `@reference.<suffix>` marks a
 * reference, and `@name` marks the identifier inside either. This module runs
 * such queries and turns the matches into definitions, references and the
 * relations built from them (calls, imports), so a language needs a grammar
 * and query files instead of hand-written code.
 *
 * Nothing here knows about a specific language. Language-specific behavior
 * lives in the query files (`queries/<lang>/`) and, as a documented exception,
 * in the override hooks of a `LanguageProfile`.
 */
import { Query, type Language, type Node, type QueryMatch } from 'web-tree-sitter';
import { kindForTagSuffix } from './symbol-kinds.js';

const DEFINITION_PREFIX = 'definition.';
const REFERENCE_PREFIX = 'reference.';
const NAME_CAPTURE = 'name';
/** Reference suffixes that are calls: `@reference.call`, and `@reference.send` (upstream C# member calls). */
const CALL_SUFFIXES: ReadonlySet<string> = new Set(['call', 'send']);
/** Reference suffix of an import; its `@name` is the module specifier. */
const IMPORT_SUFFIX = 'import';
/**
 * Optional captures of an import pattern, for the names the import binds:
 * `@import.name` (a named or default import; `@import.alias` replaces it when
 * the pattern captures both) and `@import.module` (a name bound to the module
 * itself: `import * as m`).
 */
const IMPORT_NAME_CAPTURE = 'import.name';
const IMPORT_ALIAS_CAPTURE = 'import.alias';
const IMPORT_MODULE_CAPTURE = 'import.module';
/** The relation suffixes, as they appear in query text. */
const RELATION_CAPTURES = [...CALL_SUFFIXES, IMPORT_SUFFIX].map((suffix) => `@${REFERENCE_PREFIX}${suffix}`);

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

/** A call found in the syntax tree, positioned at the callee name. */
export interface CallSite {
  /** The callee as written: the last name of `a.b.c()`, `A::b()`, `new ns.C()`. */
  name: string;
  /** 1-based line of the name. */
  line: number;
  /** 0-based column of the name. */
  col: number;
  /**
   * Set when the call has a receiver (`a.b()`, `a?.b()`, `a::b()`, `a->b()`):
   * the last name of the receiver expression (`a`, `this`, `store` for
   * `this.store.get()`, `super` for `super().m()`), or `*` when the receiver
   * does not end in a name (`make().b()`, `list[0].b()`).
   */
  receiver?: string;
  /**
   * The innermost enclosing definition that can make a call: a function, a
   * method, a class (member initializers) or a variable whose value is a
   * function. Absent for a call at the top level of the file or inside a
   * callback that is not bound to a name there.
   */
  caller?: { name: string; kind: string; line: number };
}

/** A name an import binds in the importing file. */
export interface ImportedName {
  /** The local name: the alias when there is one. */
  name: string;
  /** True when the name stands for the module itself (`import * as m`, `import pkg.mod`, a Go import alias). */
  module?: true;
}

/** An import found in the syntax tree. */
export interface ImportSite {
  /** The module as written, without quotes: `./greet.js`, `.pkg.mod`, `example.com/m/util`. */
  specifier: string;
  /** 1-based line the import statement starts on. */
  line: number;
  /** 0-based column of the specifier. */
  col: number;
  /** The names the import binds, in source order; absent when the query captures none. */
  names?: ImportedName[];
}

/** What the relation extractor needs from the syntax tree of one file. */
export interface ParsedReferences {
  /** In document order. */
  calls: CallSite[];
  /** In document order. */
  imports: ImportSite[];
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
  /** The reference patterns that tag a call or an import. */
  private readonly relationPatterns: Array<{ layer: string; text: string }> = [];
  private definitionQuery: CompiledPatterns | null = null;
  private referenceQuery: CompiledPatterns | null = null;
  private relationQuery: CompiledPatterns | null = null;
  /** Definition patterns followed by relation patterns: one tree walk for both (see `analyze`). */
  private combinedQuery: CompiledPatterns | null = null;
  /** Indexes (into `relationPatterns`) of the patterns that cannot be evaluated (see `relations`). */
  private unevaluated: ReadonlySet<number> | null = null;

  constructor(language: Language, layers: readonly TagsQueryLayer[]) {
    this.language = language;
    for (const layer of layers) {
      const patterns = splitPatterns(layer.source);
      this.validate(layer, patterns.length);
      for (const text of patterns) {
        // A pattern with only `@name` (upstream Go has some) tags nothing and is dropped.
        if (text.includes(`@${DEFINITION_PREFIX}`)) this.definitionPatterns.push({ layer: layer.name, text });
        if (text.includes(`@${REFERENCE_PREFIX}`)) this.referencePatterns.push({ layer: layer.name, text });
        if (RELATION_CAPTURES.some((capture) => text.includes(capture))) this.relationPatterns.push({ layer: layer.name, text });
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
    return this.definitionsFrom(compiled.query.matches(root));
  }

  /** Builds the definitions from matches whose pattern indexes are indexes into `definitionPatterns`. */
  private definitionsFrom(matches: readonly QueryMatch[]): TagDefinition[] {
    // name node id → winning match (lowest pattern index = earliest layer).
    const byName = new Map<number, { pattern: number; definition: TagDefinition }>();
    for (const match of matches) {
      if (match.patternIndex >= this.definitionPatterns.length) continue;
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
          layer: this.definitionPatterns[match.patternIndex].layer,
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
  references(root: Node, definitions: readonly TagDefinition[] = this.definitions(root)): TagReference[] {
    if (!this.definitionQuery) throw new Error('TagsQuery used after delete()');
    this.referenceQuery ??= this.compile(this.referencePatterns);

    const definitionNames = new Set(definitions.map((d) => d.nameNode.id));
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

  /**
   * Calls (`@reference.call`, `@reference.send`) and imports
   * (`@reference.import`) under `root`, each positioned by its `@name`. This is
   * where the call graph comes from: a call is a node the grammar parsed as a
   * call, so text in strings and comments, keywords followed by `(` and
   * declarations never match.
   *
   * Only the patterns that tag a call or an import are run, not the (much
   * broader) type references. The name of a definition is never a call. A
   * pattern with a property predicate (`#is?`, `#is-not?`, e.g. upstream
   * Ruby's `(identifier) @name @reference.call (#is-not? local)`) is skipped:
   * the runtime does not evaluate those, and without the predicate the
   * pattern would report every identifier as a call.
   *
   * @param definitions - the result of `definitions(root)`, when already computed
   */
  relations(
    root: Node,
    definitions: readonly TagDefinition[] = this.definitions(root),
    source: string = root.text,
  ): ParsedReferences {
    if (!this.definitionQuery) throw new Error('TagsQuery used after delete()');
    if (this.relationPatterns.length === 0) return { calls: [], imports: [] };
    this.relationQuery ??= this.compile(this.relationPatterns);
    const skipped = this.unevaluatedIn(this.relationQuery.query, 0);
    return this.relationsFrom(this.relationQuery.query.matches(root), 0, skipped, definitions, source);
  }

  /**
   * `definitions(root)` and `relations(root)` in one walk of the tree: what
   * the parser needs for every file of a language with a call graph.
   *
   * @param source - the text the tree was parsed from, when the caller has it
   */
  analyze(root: Node, source: string = root.text): { definitions: TagDefinition[]; references: ParsedReferences } {
    if (!this.definitionQuery) throw new Error('TagsQuery used after delete()');
    if (this.relationPatterns.length === 0) return { definitions: this.definitions(root), references: { calls: [], imports: [] } };
    this.combinedQuery ??= this.compile([...this.definitionPatterns, ...this.relationPatterns]);
    const offset = this.definitionPatterns.length;
    const matches = this.combinedQuery.query.matches(root);
    const definitions = this.definitionsFrom(matches);
    const skipped = this.unevaluatedIn(this.combinedQuery.query, offset);
    return { definitions, references: this.relationsFrom(matches, offset, skipped, definitions, source) };
  }

  /** The relation patterns of `query` (which start at pattern `offset`) that have a property predicate. */
  private unevaluatedIn(query: Query, offset: number): ReadonlySet<number> {
    if (this.unevaluated) return this.unevaluated;
    const skipped = new Set<number>();
    for (let i = 0; i < this.relationPatterns.length; i++) {
      if (hasProperties(query.assertedProperties[offset + i]) || hasProperties(query.refutedProperties[offset + i])) skipped.add(i);
    }
    this.unevaluated = skipped;
    return skipped;
  }

  /** Builds calls and imports from matches; relation pattern `i` has pattern index `offset + i`. */
  private relationsFrom(
    matches: readonly QueryMatch[],
    offset: number,
    skipped: ReadonlySet<number>,
    definitions: readonly TagDefinition[],
    source: string,
  ): ParsedReferences {
    const definitionNames = new Set(definitions.map((d) => d.nameNode.id));
    const seenCalls = new Set<number>();
    const calls: Array<CallSite & { index: number }> = [];
    /** Imports by the node of their specifier: several patterns may describe one import. */
    const imports = new Map<number, ImportSite & { index: number; bound: Map<number, ImportedName & { index: number }> }>();
    for (const match of matches) {
      const pattern = match.patternIndex - offset;
      if (pattern < 0 || skipped.has(pattern)) continue;
      let nameNode: Node | undefined;
      let node: Node | undefined;
      let suffix = '';
      let importName: Node | undefined;
      let importAlias: Node | undefined;
      let importModule: Node | undefined;
      for (const capture of match.captures) {
        if (capture.name === NAME_CAPTURE) nameNode ??= capture.node;
        else if (capture.name === IMPORT_NAME_CAPTURE) importName ??= capture.node;
        else if (capture.name === IMPORT_ALIAS_CAPTURE) importAlias ??= capture.node;
        else if (capture.name === IMPORT_MODULE_CAPTURE) importModule ??= capture.node;
        else if (!node && capture.name.startsWith(REFERENCE_PREFIX)) {
          node = capture.node;
          suffix = capture.name.slice(REFERENCE_PREFIX.length);
        }
      }
      if (!nameNode || !node || definitionNames.has(nameNode.id)) continue;
      const name = nameNode.text;
      if (name.length === 0) continue;

      if (suffix === IMPORT_SUFFIX) {
        let site = imports.get(nameNode.id);
        if (!site) {
          site = {
            specifier: name,
            line: node.startPosition.row + 1,
            col: nameNode.startPosition.column,
            index: nameNode.startIndex,
            bound: new Map(),
          };
          imports.set(nameNode.id, site);
        }
        const local = importModule ?? importAlias ?? importName;
        if (local && !site.bound.has(local.id)) {
          site.bound.set(local.id, { name: local.text, index: local.startIndex, ...(importModule ? { module: true as const } : {}) });
        }
        continue;
      }

      if (!CALL_SUFFIXES.has(suffix) || seenCalls.has(nameNode.id)) continue;
      seenCalls.add(nameNode.id);
      const receiver = receiverOf(nameNode, node, source);
      calls.push({
        name,
        line: nameNode.startPosition.row + 1,
        col: nameNode.startPosition.column,
        index: nameNode.startIndex,
        ...(receiver !== undefined ? { receiver } : {}),
      });
    }

    calls.sort((a, b) => a.index - b.index);
    assignCallers(calls, definitions);
    return {
      calls: calls.map(({ index: _index, ...call }) => call),
      imports: [...imports.values()]
        .sort((a, b) => a.index - b.index)
        .map(({ index: _index, bound, ...site }) => {
          if (bound.size === 0) return site;
          const names = [...bound.values()].sort((a, b) => a.index - b.index).map(({ index: _i, ...boundName }) => boundName);
          return { ...site, names };
        }),
    };
  }

  /** Releases the compiled queries. The instance must not be used afterwards. */
  delete(): void {
    this.definitionQuery?.query.delete();
    this.referenceQuery?.query.delete();
    this.relationQuery?.query.delete();
    this.combinedQuery?.query.delete();
    this.combinedQuery = null;
    this.definitionQuery = null;
    this.referenceQuery = null;
    this.relationQuery = null;
  }
}

/** What separates a receiver from the member that is called on it. */
const MEMBER_OPERATOR = /^\s*(?:\?\.|\.|::|->|\?->|&\.|!!?\.|:)/;
/** The name a receiver expression ends in. */
const TRAILING_NAME = /[A-Za-z_$@][\w$]*$/;
/** `super().method()` (Python): the receiver is the parent class. */
const SUPER_CALL = /^super\s*\(\s*\)$/;
/** Receivers longer than this are not read (`*`): only their last name matters. */
const MAX_RECEIVER_LENGTH = 200;

function isCommentNode(node: Node): boolean {
  return node.type.includes('comment');
}

/** The name a receiver is recorded by: its last name, `super` for `super()`, otherwise `*`. */
function receiverName(node: Node, source: string): string {
  if (node.endIndex - node.startIndex > MAX_RECEIVER_LENGTH) return '*';
  const text = source.slice(node.startIndex, node.endIndex).trim();
  if (SUPER_CALL.test(text)) return 'super';
  return TRAILING_NAME.exec(text)?.[0] ?? '*';
}

/**
 * The receiver of the call whose callee name is `nameNode`, for any grammar,
 * or `undefined` when it has none.
 *
 * A callee with a receiver is a member, field, scoped or navigation node that
 * holds the receiver before the name: `a.b`, `a?.b`, `a::b`, `a->b`, `a:b`.
 * So the receiver is the closest named node before the name, anywhere between
 * the name and the call node, that is joined to the name by a member operator.
 * The operator check keeps unrelated siblings out (`MODE=fast cmd` in a shell
 * command, the type arguments of `obj.<T>m()`).
 *
 * @param referenceNode - the node captured as `@reference.call`: the call, or
 *   its argument list (upstream JavaScript and Java)
 */
function receiverOf(nameNode: Node, referenceNode: Node, source: string): string | undefined {
  const contains = referenceNode.startIndex <= nameNode.startIndex && referenceNode.endIndex >= nameNode.endIndex;
  const call = contains ? referenceNode : referenceNode.parent;
  for (let current: Node | null = nameNode; current && current.id !== call?.id; current = current.parent) {
    for (let before = current.previousNamedSibling; before; before = before.previousNamedSibling) {
      if (isCommentNode(before)) continue;
      if (MEMBER_OPERATOR.test(source.slice(before.endIndex, nameNode.startIndex))) return receiverName(before, source);
    }
  }
  return undefined;
}

/** Kinds that make calls: a class owns the calls of its member initializers. */
const CALLER_KINDS: ReadonlySet<string> = new Set(['function', 'method', 'class']);
/** Kinds that make calls only when their value is a function (`double = lambda n: ...`). */
const VALUE_KINDS: ReadonlySet<string> = new Set(['variable', 'constant']);

/** True if the calls directly inside `definition` are made by it. */
function makesCalls(definition: TagDefinition): boolean {
  if (CALLER_KINDS.has(definition.kind)) return true;
  if (!VALUE_KINDS.has(definition.kind)) return false;
  const value = definition.node.childForFieldName('value') ?? definition.node.childForFieldName('right');
  return value !== null && value.childForFieldName('body') !== null;
}

/**
 * Sets `caller` on each call: the innermost definition around it that makes
 * calls (see `makesCalls`). A call in the initializer of a plain variable
 * belongs to whatever encloses the variable, and a call that nothing encloses
 * gets no caller. Both lists are in document order, so one pass is enough.
 */
function assignCallers(calls: Array<CallSite & { index: number }>, definitions: readonly TagDefinition[]): void {
  const open: Array<{ definition: TagDefinition; makesCalls?: boolean }> = [];
  let next = 0;
  for (const call of calls) {
    for (; next < definitions.length && definitions[next].node.startIndex <= call.index; next++) {
      open.push({ definition: definitions[next] });
    }
    while (open.length > 0 && open[open.length - 1].definition.node.endIndex <= call.index) open.pop();
    for (let i = open.length - 1; i >= 0; i--) {
      const entry = open[i];
      // A definition that ended before this call may still sit below a later one.
      if (entry.definition.node.endIndex <= call.index) continue;
      entry.makesCalls ??= makesCalls(entry.definition);
      if (!entry.makesCalls) continue;
      const { name, kind, node } = entry.definition;
      call.caller = { name, kind, line: node.startPosition.row + 1 };
      break;
    }
  }
}

function hasProperties(properties: Record<string, string | null> | undefined): boolean {
  return properties !== undefined && properties !== null && Object.keys(properties).length > 0;
}

/** Node types that are the body of a function in some grammar (`block`, `function_body`, `compound_statement`, ...). */
const BODY_NODE_TYPE = /(^|_)(body|block)$|^compound_statement$|^statement_block$/;

/**
 * True if a function or method definition has a body, for any language. A
 * definition without one only declares the callable: a C/C++ prototype, an
 * interface, abstract or trait method.
 *
 * The body is the grammar's `body` field of the node or of the function it
 * binds (`const f = () => 1`, `{ key: function () {} }`), or a child whose
 * type names a body. Grammars that drop an empty body from the tree
 * (`def f; end`, `function f() end`) still close the definition with `end`.
 */
export function hasBody(node: Node): boolean {
  if (node.childForFieldName('body')) return true;
  const value = node.childForFieldName('value') ?? node.childForFieldName('right');
  if (value?.childForFieldName('body')) return true;
  if (node.lastChild?.type === 'end') return true;
  for (const child of node.namedChildren) {
    if (child && BODY_NODE_TYPE.test(child.type)) return true;
  }
  return false;
}

/** The parameter list of a definition, or of the function it binds (`const f = (a) => a`, `{ key: function (a) {} }`). */
function parametersOf(node: Node): Node | null {
  const own = node.childForFieldName('parameters');
  if (own) return own;
  const value = node.childForFieldName('value') ?? node.childForFieldName('right');
  return value?.childForFieldName('parameters') ?? null;
}

/** Joins the lines of a parameter list into one: `f(\n  a,\n  b,\n)` → `f(a, b)`. */
function joinLines(text: string): string {
  let joined = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (joined.length === 0 || /[([]$/.test(joined)) {
      joined += line;
    } else if (/^[)\]]/.test(line)) {
      joined = joined.replace(/,$/, '') + line;
    } else {
      joined += ` ${line}`;
    }
  }
  return joined;
}

/**
 * Signature of a definition, for any language: the first line of the node,
 * without its body and without a trailing block opener (`{` or `:`), trimmed
 * and capped at `MAX_SIGNATURE_LENGTH` characters.
 *
 * The body is recognized by the grammar's `body` field, which most grammars
 * use for function, class and interface bodies; a one-line definition such as
 * `func f() int { return 1 }` therefore yields `func f() int`.
 *
 * A parameter list (the grammar's `parameters` field) that starts on the first
 * line and ends on a later one is included in full, joined into one line, up
 * to the end of the line it closes on.
 */
export function signatureOf(node: Node, source: string): string {
  const body = node.childForFieldName('body');
  let end = body && body.startIndex > node.startIndex ? body.startIndex : node.endIndex;
  const lineEnd = (from: number): number => {
    const newline = source.indexOf('\n', from);
    return newline === -1 || newline > end ? end : newline;
  };

  let stop = lineEnd(node.startIndex);
  if (stop < end) {
    const parameters = parametersOf(node);
    if (parameters && parameters.startIndex < stop && parameters.endIndex > stop) {
      const ownerBody = parameters.parent?.childForFieldName('body');
      if (ownerBody && ownerBody.startIndex >= parameters.endIndex) end = Math.min(end, ownerBody.startIndex);
      stop = lineEnd(parameters.endIndex);
      // Comments between parameters are not part of the signature.
      let text = '';
      let from = node.startIndex;
      for (const child of parameters.namedChildren) {
        if (!child || !child.type.includes('comment')) continue;
        text += source.slice(from, child.startIndex);
        from = child.endIndex;
      }
      const joined = joinLines(text + source.slice(from, stop));
      return joined.replace(/\s*[{:]$/, '').trimEnd().slice(0, MAX_SIGNATURE_LENGTH);
    }
  }
  const firstLine = source.slice(node.startIndex, stop).trim();
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
