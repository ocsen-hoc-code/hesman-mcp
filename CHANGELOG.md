# Changelog

## v1.0.0 (2026-07-11)

### Phase 1: Core MCP Server (Foundation)

- **MCP server core** with stdio transport, tool registration, and request handling via `@modelcontextprotocol/sdk`
- **Tree-sitter parsing layer** for TypeScript/JavaScript — init parser, parse files, extract symbols
- **SQLite symbol index** — schema, migrations, CRUD operations for symbols and file hashes
- **Config system** — `hesman.config.json` loading, Zod validation, environment variable overrides, CLI flag parsing
- **CLI entry point** — `hesman` command with `index`, `status`, `install`, `clean` subcommands
- **First tools**: `find_symbol`, `get_file_structure`, `get_references`, `get_context`, `index_status`
- **Logging** with pino — structured JSON logs with human-readable output
- **Diagnostics CLI** (`hesman diag`) — memory, store stats, and configuration report

### Phase 2: Data Pipeline & Compression

- **3-layer compression pipeline**:
  - Layer 1: Compact mode — strip comments, collapse blank lines, remove trailing whitespace
  - Layer 2: Context pruning — keep only relevant lines around a focus symbol (callers, callees, doc comments) with merge-ranges optimization
  - Layer 3: Smart summarization — extract signatures, doc comments, call lists, complexity metrics
- **AST-aware compact mode** (level 2) — preserves JSDoc, strips unused imports
- **Response compressor** — `_summary` blocks for list, chain, and dependency tools; `_meta` with token reduction stats
- **Relation extraction** — calls, imports, extends, implements via regex-based AST traversal
- **Vector store integration** with `@zvec/zvec` — 384-dim HNSW + FTS hybrid search
- **Embedding pipeline** via `@xenova/transformers` — all-MiniLM-L6-v2, fully local
- **Symbol chunker** for embedding — per-symbol text chunks with signature + code + doc comments
- **Improved `get_context`** — compact mode, symbol-in-range detection, language detection from extension
- **Metrics collector** — query latency, cache hit rates, memory snapshots

### Phase 3: Graph Intelligence

- **Five new tools**:
  - `get_callers` — traverse call graph upward with configurable depth (max 3)
  - `get_callees` — traverse call graph downward with configurable depth (max 3)
  - `find_pattern` — structural pattern search with `$NAME` and `$$$ARGS` named captures
  - `impact_analysis` — categorize breaking changes by severity (must_fix / should_review / info)
  - `list_dependencies` — file and project-level import analysis
- **Call chain compression** — `_summary` with direct/transitive counts and file groupings
- **Symbol summarizer** — `summarizeSymbol()` for complexity metrics, call lists, return types
- **`compressCallChain()`** — human-readable chain summaries

### Phase 4: Python, Go & Monorepo

- **Python language profile** — `function_definition`, `class_definition`, `decorated_definition`; relation queries for calls, imports, extends; docstring extraction (triple-quoted)
- **Go language profile** — `function_declaration`, `method_declaration`, `type_spec`, `const_spec`; relation queries for calls, imports; `//` doc comment extraction
- **Monorepo detector** — auto-detect pnpm, lerna, nx, turbo, npm workspaces
- **Monorepo coordinator** — index all workspace packages, discover cross-package relations
- **Glob expansion** for workspace patterns — `packages/*`, `libs/*`, etc.
- **Language profile interface** — `LanguageProfile` type with `extensions`, `symbolNodeTypes`, `relationQueries`, `extractSignature`, `extractDocComment`

### Phase 5: Performance & Production Readiness

- **Worker pool** — auto-sized thread pool (`cpus().length - 1`), task dispatch, drain, graceful termination
- **File watcher** via chokidar — incremental re-indexing on change/add/unlink with 2s rate-limiting
- **Graceful shutdown** — SIGINT/SIGTERM handler: stop watcher, drain pool (5s timeout), flush stores, terminate workers
- **Fuzzy symbol search** — FTS5-based text search for `find_symbol` with `exact`/`fuzzy`/`prefix` modes
- **Response compression** — `compressToolResponse()` with layer metadata per tool
- **Content-hash based incremental indexing** — skip re-parsing unchanged files via SHA-256
- **Improved compact mode** — `// @ts-ignore`, `// eslint-disable-*` magic comment preservation
- **Performance benchmarks** — vitest bench suite for indexing, embedding, query, compact-mode, memory, zvec-search
- **CI pipeline** — typecheck, lint, build, unit + integration tests, e2e tests, performance benchmarks on Ubuntu/macOS/Windows
- **npm publish workflow** — automated publishing on release

### Full Details

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for architecture decisions, [docs/TOOLS.md](./docs/TOOLS.md) for tool reference, and [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) for development setup.
