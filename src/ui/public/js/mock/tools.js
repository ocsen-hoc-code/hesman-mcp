// Mock implementations of the 11 MCP tools over the made-up project.
// The schemas mirror src/server/tools/*.ts as of 2026-10-12; the real backend sends its own.

const SYMBOL_KINDS = ['function', 'class', 'method', 'variable', 'interface', 'type', 'enum', 'namespace', 'constant'];
const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, description });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const schema = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const symbolIdArg = (what) => str(`Symbol ID to ${what}`);

export const TOOLS = [
  {
    name: 'find_symbol',
    description: 'Find a symbol (function, class, variable, ...) by name',
    inputSchema: schema(
      {
        name: str('Symbol name to search for'),
        kind: str('Filter by symbol kind', { enum: SYMBOL_KINDS }),
        filePath: str('Limit search to this file path'),
        matchMode: str('Match mode (default: "fuzzy"). exact=precise name, prefix=starts with, fuzzy=FTS5 text search', {
          enum: ['exact', 'fuzzy', 'prefix'],
        }),
        topK: int(1, 200, 'Max results (default 20, max 200)'),
      },
      ['name'],
    ),
  },
  {
    name: 'get_file_structure',
    description: 'Get the symbol structure of a file',
    inputSchema: schema(
      {
        filePath: str('Path to the file to analyze'),
        includeNested: { type: 'boolean', description: 'Include nested symbols (methods in classes). Default: true' },
      },
      ['filePath'],
    ),
  },
  {
    name: 'get_references',
    description: 'Find all usages of a symbol',
    inputSchema: schema(
      {
        symbolId: symbolIdArg('find references for'),
        referenceKind: str('Filter: calls, import, extends, implements, type_ref, all'),
        topK: int(1, 200, 'Max results (default 50, max 200)'),
        cursor: str('Pagination cursor from previous response'),
      },
      ['symbolId'],
    ),
  },
  {
    name: 'get_callers',
    description: 'Find all callers of a symbol, with configurable call chain depth',
    inputSchema: schema(
      {
        symbolId: symbolIdArg('find callers for'),
        maxDepth: int(1, 3, 'Max call chain depth (default 1, max 3)'),
        topK: int(1, 200, 'Max results (default 50, max 200)'),
      },
      ['symbolId'],
    ),
  },
  {
    name: 'get_callees',
    description: 'Find all callees of a symbol, with configurable call chain depth',
    inputSchema: schema(
      {
        symbolId: symbolIdArg('find callees for'),
        maxDepth: int(1, 3, 'Max call chain depth (default 1, max 3)'),
        topK: int(1, 200, 'Max results (default 50, max 200)'),
      },
      ['symbolId'],
    ),
  },
  {
    name: 'get_context',
    description: 'Get surrounding code at a location with optional compact mode',
    inputSchema: schema(
      {
        filePath: str('Absolute or relative file path'),
        startLine: int(1, 1000000, 'Focus line number (1-indexed)'),
        endLine: int(1, 1000000, 'End line (default: same as startLine)'),
        contextLines: int(0, 200, 'Lines of context above and below (default: 5, max 200)'),
        mode: str('Compact mode strips comments and blank lines (default: compact)', { enum: ['compact', 'full'] }),
        symbolName: str('Optional — return symbols in range'),
      },
      ['filePath', 'startLine'],
    ),
  },
  {
    name: 'semantic_search',
    description: 'Search code by meaning using local embeddings',
    inputSchema: schema(
      {
        query: str('Natural language query to search for'),
        topK: int(1, 50, 'Max results (default 10, max 50)'),
        filePattern: str('Glob filter, e.g. "src/**/*.ts"'),
        language: str('Filter by language, or the label of a language without a grammar such as "sql" or "yaml"'),
        kind: str('Filter by symbol kind; "text" selects chunks of files without a grammar', { enum: [...SYMBOL_KINDS, 'text'] }),
        minScore: { type: 'number', minimum: 0, maximum: 1, description: 'Minimum score threshold (0-1, default 0.0)' },
      },
      ['query'],
    ),
  },
  {
    name: 'find_pattern',
    description: 'Search code by structural pattern with named captures ($NAME for word tokens, $$$ARGS for greedy capture)',
    inputSchema: schema(
      {
        pattern: str('Structural pattern like console.$METHOD($$$ARGS)', { maxLength: 500 }),
        language: str('Language to search in, e.g. "typescript", or a text label such as "sql"'),
        filePattern: str('Glob matched against the path relative to the project root'),
        topK: int(1, 100, 'Max results (default 20, max 100)'),
      },
      ['pattern', 'language'],
    ),
  },
  {
    name: 'list_dependencies',
    description: 'List the import dependencies of a file or of the whole project',
    inputSchema: schema({
      filePath: str('File path to analyze (optional; returns all project-level imports if omitted)'),
      direction: str('Direction: "imports" (default), "imported_by", or "both"', { enum: ['imports', 'imported_by', 'both'] }),
    }),
  },
  {
    name: 'impact_analysis',
    description: 'Analyze what breaks if a symbol changes — categorized by severity with suggested actions',
    inputSchema: schema(
      {
        symbolId: symbolIdArg('analyze'),
        changeType: { type: 'string', enum: ['rename', 'change_signature', 'delete', 'change_return_type'] },
        newName: str('New name (if rename)'),
        newSignature: str('New signature (if change_signature)'),
        newReturnType: str('New return type (if change_return_type)'),
        maxFiles: int(1, 200, 'Max impacted files in output (default 20, max 200)'),
      },
      ['symbolId', 'changeType'],
    ),
  },
  {
    name: 'index_status',
    description: 'Check the indexing status of the project, including progress of the initial background index',
    inputSchema: schema({}),
  },
];

class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const tokens = (value) => Math.ceil(JSON.stringify(value).length / 4);

/** Attach `_meta` the way the response compressor does. `factor` is original / returned size. */
function withMeta(payload, factor = 1, layers = []) {
  const compressedTokens = tokens(payload);
  const originalTokens = Math.round(compressedTokens * factor);
  const reduction = `${((1 - compressedTokens / originalTokens) * 100).toFixed(1)}%`;
  return { ...payload, _meta: { originalTokens, compressedTokens, reduction, compressed: false, layers } };
}

/** Signature text for a symbol, shaped by language. */
export function signatureOf(symbol) {
  const { name, kind, language } = symbol;
  if (language === 'python') return kind === 'class' ? `class ${name}:` : `def ${name}(${kind === 'method' ? 'self' : ''}):`;
  if (language === 'go') return kind === 'class' ? `type ${name} struct` : `func ${name}()`;
  switch (kind) {
    case 'class':
    case 'interface':
    case 'enum':
      return `export ${kind} ${name}`;
    case 'type':
      return `export type ${name} = …`;
    case 'constant':
    case 'variable':
      return `const ${name} = …`;
    case 'method':
      return `${name}(): Promise<void>`;
    default:
      return `${symbol.isExported ? 'export ' : ''}function ${name}(input: unknown): Promise<void>`;
  }
}

const present = (symbol) => ({
  id: symbol.id,
  name: symbol.name,
  kind: symbol.kind,
  filePath: symbol.filePath,
  startLine: symbol.startLine,
  endLine: symbol.endLine,
  signature: signatureOf(symbol),
  docComment: null,
  isExported: symbol.isExported,
  parentName: null,
  language: symbol.language,
});

function requireSymbol(project, args) {
  if (!args.symbolId) throw new ToolError('INVALID_INPUT', 'symbolId is required');
  const symbol = project.byId.get(args.symbolId);
  if (!symbol) throw new ToolError('SYMBOL_NOT_FOUND', `Symbol not found: ${args.symbolId}`);
  return symbol;
}

function requireFile(project, args) {
  if (!args.filePath || typeof args.filePath !== 'string') throw new ToolError('INVALID_INPUT', 'filePath is required');
  if (!project.files.some((f) => f.id === args.filePath)) throw new ToolError('FILE_NOT_FOUND', `File not found: ${args.filePath}`);
  return args.filePath;
}

function related(project, symbol, direction, kind, limit) {
  return project.edges
    .filter((e) => (direction === 'in' ? e.to : e.from) === symbol.id && (!kind || e.kind === kind))
    .slice(0, limit)
    .map((e) => ({ edge: e, other: project.byId.get(direction === 'in' ? e.from : e.to) }));
}

const callRow = ({ edge, other }) => ({
  symbolId: other.id,
  name: other.name,
  kind: other.kind,
  filePath: other.filePath,
  depth: 1,
  callSite: { line: edge.line },
});

const HANDLERS = {
  find_symbol(project, args) {
    if (!args.name) throw new ToolError('INVALID_INPUT', 'name is required');
    const needle = String(args.name).toLowerCase();
    const mode = args.matchMode ?? 'fuzzy';
    const match = (name) =>
      mode === 'exact' ? name === needle : mode === 'prefix' ? name.startsWith(needle) : name.includes(needle);
    const symbols = project.symbols
      .filter((s) => match(s.name.toLowerCase()))
      .filter((s) => (!args.kind || s.kind === args.kind) && (!args.filePath || s.filePath === args.filePath))
      .slice(0, args.topK ?? 20)
      .map(present);
    return withMeta({ symbols, tookMs: 1.4 }, 1.6, symbols.length > 0 ? ['compact'] : []);
  },
  get_file_structure(project, args) {
    const filePath = requireFile(project, args);
    const own = project.symbols.filter((s) => s.filePath === filePath);
    const nested = args.includeNested !== false;
    const top = own.filter((s) => s.kind !== 'method').map((s) => ({ ...present(s), children: [] }));
    if (nested) {
      for (const method of own.filter((s) => s.kind === 'method')) {
        top.find((s) => s.name === method.parentName)?.children.push(present(method));
      }
    }
    return withMeta({ filePath, language: own[0].language, symbols: top, tookMs: 0.9 });
  },
  get_references(project, args) {
    const symbol = requireSymbol(project, args);
    const kind = args.referenceKind && args.referenceKind !== 'all' ? args.referenceKind : undefined;
    const references = related(project, symbol, 'in', kind, args.topK ?? 50).map(({ edge, other }) => ({
      symbolId: other.id,
      name: other.name,
      referenceKind: edge.kind,
      filePath: other.filePath,
      line: edge.line,
    }));
    return withMeta({ references, nextCursor: null, tookMs: 1.1 });
  },
  get_callers(project, args) {
    const symbol = requireSymbol(project, args);
    return withMeta({ callers: related(project, symbol, 'in', 'calls', args.topK ?? 50).map(callRow), tookMs: 0.8 });
  },
  get_callees(project, args) {
    const symbol = requireSymbol(project, args);
    return withMeta({ callees: related(project, symbol, 'out', 'calls', args.topK ?? 50).map(callRow), tookMs: 0.7 });
  },
  get_context(project, args) {
    const filePath = requireFile(project, args);
    if (!Number.isInteger(args.startLine)) throw new ToolError('INVALID_INPUT', 'startLine must be an integer');
    const context = args.contextLines ?? 5;
    const startLine = Math.max(1, args.startLine - context);
    const endLine = Math.max(args.endLine ?? args.startLine, args.startLine) + context;
    const inRange = project.symbols.filter((s) => s.filePath === filePath && s.startLine <= endLine && s.endLine >= startLine);
    const lines = inRange.flatMap((s) => [`${s.startLine}: ${signatureOf(s)} {`, `${s.startLine + 1}:   logEvent('${s.name}');`, `${s.endLine}: }`]);
    const payload = {
      filePath,
      language: inRange[0]?.language ?? 'typescript',
      startLine,
      endLine,
      mode: args.mode ?? 'compact',
      content: lines.join('\n') || `${startLine}: // (blank lines)`,
      symbolsInRange: inRange.map((s) => ({ id: s.id, name: s.name, kind: s.kind, startLine: s.startLine })),
    };
    return withMeta(payload, 9.5, ['prune']);
  },
  semantic_search(project, args) {
    if (!args.query || !String(args.query).trim()) throw new ToolError('INVALID_INPUT', 'query is required and must be non-empty');
    const words = String(args.query).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const scored = project.symbols
      .map((s) => {
        const haystack = `${s.name} ${s.filePath}`.toLowerCase();
        const hits = words.filter((w) => haystack.includes(w)).length;
        return { symbol: s, score: Math.min(0.92, 0.22 + hits * 0.19 + (s.name.length % 7) / 100) };
      })
      .filter((r) => (!args.kind || r.symbol.kind === args.kind) && (!args.language || r.symbol.language === args.language))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, (args.topK ?? 10) - 1))
      .map((r) => ({ symbolId: r.symbol.id, name: r.symbol.name, kind: r.symbol.kind, filePath: r.symbol.filePath, startLine: r.symbol.startLine, endLine: r.symbol.endLine, language: r.symbol.language, score: Number(r.score.toFixed(3)) }));
    const textChunk = { name: 'docs/checkout.md:12-38', kind: 'text', precision: 'text', filePath: 'docs/checkout.md', startLine: 12, endLine: 38, language: 'markdown', score: 0.31 };
    const includeText = project.symbols.length > 0 && (!args.kind || args.kind === 'text') && (!args.language || args.language === 'markdown');
    const results = (includeText ? [...scored, textChunk] : scored).filter((r) => r.score >= (args.minScore ?? 0));
    return withMeta({ results, tookMs: 38.2 }, 2.4, results.length > 0 ? ['compact'] : []);
  },
  find_pattern(project, args) {
    if (!args.pattern) throw new ToolError('INVALID_INPUT', 'pattern is required');
    if (!args.language) throw new ToolError('INVALID_INPUT', 'language is required');
    const matches = project.symbols
      .filter((s) => s.language === args.language && (s.kind === 'function' || s.kind === 'method'))
      .slice(0, Math.min(args.topK ?? 20, 6))
      .map((s) => ({ filePath: s.filePath, line: s.startLine + 1, snippet: `  logEvent('${s.name}');`, captures: { ARGS: `'${s.name}'` } }));
    return withMeta({ pattern: args.pattern, language: args.language, matches, filesScanned: project.files.length, tookMs: 12.6 }, 3.1, ['prune']);
  },
  list_dependencies(project, args) {
    const direction = args.direction ?? 'imports';
    const pairs = new Map();
    for (const edge of project.edges) {
      const from = project.byId.get(edge.from).filePath;
      const to = project.byId.get(edge.to).filePath;
      if (from !== to) pairs.set(`${from}|${to}`, { from, to });
    }
    const all = [...pairs.values()];
    if (!args.filePath) return withMeta({ dependencies: all.slice(0, 60).map((p) => ({ filePath: p.from, imports: p.to })) });
    const filePath = requireFile(project, args);
    const payload = { filePath };
    if (direction !== 'imported_by') payload.imports = all.filter((p) => p.from === filePath).map((p) => p.to);
    if (direction !== 'imports') payload.importedBy = all.filter((p) => p.to === filePath).map((p) => p.from);
    return withMeta(payload);
  },
  impact_analysis(project, args) {
    const symbol = requireSymbol(project, args);
    if (!args.changeType) throw new ToolError('INVALID_INPUT', 'changeType is required');
    const severity = { calls: 'must_fix', extends: 'must_fix', implements: 'must_fix', imports: 'info' };
    const impacts = related(project, symbol, 'in', undefined, args.maxFiles ?? 20).map(({ edge, other }) => ({
      filePath: other.filePath,
      line: edge.line,
      symbol: other.name,
      relation: edge.kind,
      severity: severity[edge.kind] ?? 'should_review',
      suggestedAction: args.changeType === 'rename' ? `Update the reference to ${args.newName ?? 'the new name'}` : `Review this ${edge.kind} site`,
    }));
    const count = (level) => impacts.filter((i) => i.severity === level).length;
    const _summary = { totalFiles: new Set(impacts.map((i) => i.filePath)).size, mustFix: count('must_fix'), shouldReview: count('should_review'), info: count('info'), estimatedChanges: impacts.length };
    return withMeta({ symbol: present(symbol), changeType: args.changeType, _summary, impacts }, 1.3, ['compact']);
  },
};

/** Run a mock tool. Returns `{ result, isError }` like the real handlers (errors are results, not HTTP errors). */
export function runMockTool(name, args, project, indexPayload) {
  if (name === 'index_status') return { result: indexPayload, isError: false };
  try {
    return { result: HANDLERS[name](project, args ?? {}), isError: false };
  } catch (err) {
    if (err instanceof ToolError) return { result: { error: { code: err.code, message: err.message } }, isError: true };
    throw err;
  }
}
