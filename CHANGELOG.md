# Changelog

## Unreleased

### Changed

- **Project detection:** the server no longer needs a project path in its MCP entry, so one global entry works in every workspace. The project is chosen from, in order: an explicit root (`--project-root`, `HESMAN_PROJECT_ROOT`, `projectRoot` in the config file); the first workspace folder the client reports through MCP `roots` (re-resolved on `notifications/roots/list_changed`; other folders are logged); the nearest directory at or above the working directory that holds a VCS directory or a project manifest. Otherwise the server starts without a project and every tool returns the new `NO_PROJECT` error explaining how to set one. **Behavior change:** a working directory that is not inside a project is no longer indexed, and the home directory or its parents are never picked automatically. The `--project-root` flag, documented but previously ignored by the server, now works.
- **Non-blocking startup:** the server answers the MCP `initialize` handshake and `tools/list` right away (about 0.2 s on a 6,000-file project that takes 10 s to index) instead of after the embedding model load and the full initial index, so clients no longer time out on large repositories or on the first run. The model and the index load in the background: tools answer from what is indexed so far and add `_meta.indexing: { inProgress, filesDone, filesTotal }` while the index is incomplete, `index_status` gains an `indexing` block (`inProgress`, `phase`, `filesDone`, `filesTotal`, `startedAt`, `error`) and `health.embeddingModelError`, and `semantic_search` says whether the model is still loading or failed to load. Shutting down mid-index is clean.
- **Tree-sitter runtime:** `web-tree-sitter` is upgraded from `^0.22.6` to `0.25.10`, pinned exactly. The new runtime loads grammars with ABI 13–15 (the old one stopped at 14), which most current upstream grammars need. See [ADR 0001](./docs/adr/0001-grammar-distribution.md).

### Fixed

- **Parser memory leak:** a new Tree-sitter parser was created for every file and neither parsers nor syntax trees were ever freed, so WASM memory grew with the number of files indexed. One parser per language is now reused and every tree is freed after extraction.
- **MCP stream corruption:** logs were written to stdout, the JSON-RPC channel. All logs now go to stderr through one shared logger (at most one transport thread).
- **Python and Go were never indexed by the server:** the worker thread only knew TypeScript, so the real server indexed 0 Python/Go files, and the file watcher ignored `.py`/`.go` edits. Languages now come from a single registry (`src/parsers/languages.ts`).
- **Stale semantic search results:** vectors were never deleted when a file was re-indexed or removed, so `semantic_search` returned code that no longer existed. Re-indexing and file deletion now remove a file's vectors.
- **`find_pattern`:** `filePattern` never matched (it was compared to absolute paths); line numbers were 0-based. Globs now match project-relative paths and lines are 1-based. Responses include `truncated` / `truncatedReason` and a real `tookMs`.
- **Orphan processes:** the server now shuts down when stdin closes (the client went away).
- **CLI arguments:** a flag was taken as the project path (`hesman clean --force` looked for `./--force`), and `install --agent --global` set the agent to `--global`.
- **Numeric arguments:** an explicit `0` (e.g. `contextLines: 0`) is honored instead of silently replaced by the default.

### Security

- **Path confinement:** `get_context` could read any file on disk (e.g. `~/.ssh/id_rsa`). File paths are now confined to the project root by `realpath`, limited to regular files under `maxFileSizeBytes`, and outside paths fail with `PATH_OUTSIDE_PROJECT`.
- **Vector-store filter injection:** `semantic_search` `kind` / `language` were interpolated into ZVec filter expressions. They are now validated against enums (also exposed in the tool schema) and all filter values are escaped.
- **ReDoS in `find_pattern`:** patterns are size-limited and matching runs in a worker thread with a 3-second budget, so a pathological pattern can no longer freeze the server.
- **Symlinks:** the scanner and watcher no longer follow symlinks (no infinite loops, no indexing of code outside the project).
- **`hesman clean`** refuses to delete anything that is not a Hesman data directory, even with `--force`.
- **Unbounded results:** numeric tool arguments are type-checked and clamped (`topK: -1` previously disabled the SQL `LIMIT`).
- **Supply chain:** downloaded Tree-sitter grammars are verified against pinned SHA-256 hashes.
- **Agent config safety:** `hesman install` writes atomically and keeps a `.hesman.bak` backup.

See [docs/SECURITY.md](./docs/SECURITY.md) for the threat model.

### Changed

- Language extension matching is case-insensitive.
- `find_symbol` and `semantic_search` share one kind list, which now includes `constant`.
- `find_pattern` is registered even when semantic search is disabled.

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
