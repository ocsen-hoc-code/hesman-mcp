# Changelog

## Unreleased

### Added

- **`hesman setup`:** one command adds Hesman to Claude Code, Claude Desktop, OpenAI Codex CLI, Cursor, Google Antigravity, VS Code (Copilot), Gemini CLI and Windsurf. It detects the installed clients and shows a checklist; `--client <name…>`, `--all`, `--yes`, `--dry-run` (prints the exact change, writes nothing), `--scope user|project` and `--project-root <path>` cover scripted use. It uses `claude mcp add` / `codex mcp add` when those CLIs are on PATH and edits the config file otherwise; Codex `config.toml` is edited in place without touching comments or other tables. Without a terminal and without a choice it prints what it found and exits instead of waiting for input.
- **`hesman setup --command auto|npx|global|absolute`:** chooses what the clients run. `npx` writes `npx -y hesman-mcp@<major>`, `global` writes `hesman`, `absolute` writes the running Node binary plus the installed `dist/index.js`. `auto` (default) decides from how Hesman was started, without the network: from an npx cache → `npx`; `hesman` on PATH is this installation → `global`; otherwise → `absolute`. On macOS and Linux, desktop apps (Claude Desktop, Cursor, Antigravity, VS Code, Windsurf) get the `absolute` entry when `auto` picked a command that, or whose `node`, is outside the standard system directories (nvm, fnm, volta, asdf), with a note to run `hesman setup` again after switching Node versions. `hesman-mcp` is not on npm yet, so an explicit `--command npx` prints that it only works once the package is published.
- **`hesman remove`:** takes the Hesman entry out again and restores the config file byte for byte when nothing else changed since setup.
- **Text tier — files without a grammar are no longer invisible.** A file whose language has no grammar (`.sql`, `.sh`, `.rb`, `.zig`, `Dockerfile`, `Makefile`, Markdown, YAML, unknown extensions, ...) used to be skipped entirely. It is now indexed as text: blank-line-separated blocks packed into chunks of at most 30 lines. `semantic_search` ranks those chunks with symbols and marks them `kind: "text"`, `precision: "text"` and `language: <label>`; `find_pattern` accepts the label as `language` and marks the response `precision: "text"`; `get_context` reports the label and `precision: "text"`. No symbols are invented, so symbol and call-graph tools are unchanged. `semantic_search` accepts `kind: "text"` and any text-tier label as `language`; `index_status` gains `textTier` (`files`, `chunks`, per-label counts). Binaries (NUL byte in the first 8 KB), lockfiles, minified and generated files, images, archives, bulk data, secrets (`.env*`, keys) and files over 256 KB are not indexed; see "Text tier" in `docs/TOOLS.md`. **Behavior change:** existing indexes are rebuilt once (index schema 3); `indexing.filesTotal` now includes text files; the `language` argument of `semantic_search` is no longer an enum in the tool schema. Measured on this repository: +60 files and +343 chunks next to 173 parsed files, index time 17–19 s -> 28 s, data directory 11.5 MB -> 13.5 MB.
- **Language conformance suite:** `npm run test:conformance` checks every language in the registry against fixtures in `tests/fixtures/languages/<id>/` and an `expected.json` next to them: the grammar loads in the pinned Tree-sitter runtime, every vendored query compiles against it, the fixtures parse, the listed definitions are extracted (name, kind, line, exported, signature, doc comment), `deep` languages yield the listed calls, and the same fixtures indexed through the worker pool reach SQLite. A registry entry without fixtures fails with instructions, and both parts print a per-language pass/fail table (`HESMAN_CONFORMANCE_REPORT=<dir>` also writes it as Markdown and JSON). Registry entries now declare a `tier` (`deep` or `structural`). The suite documents, as known gaps, what it found: `.tsx`/`.jsx` files parse with errors under the TypeScript grammar (one arrow-function component is indexed as a variable), declarations local to an exported TypeScript/JavaScript function and `private` class members are reported as exported, CommonJS `module.exports` is not recognized as an export, and the names of a Python tuple assignment (`A, B = 1, 2`) are not indexed.

### Deprecated

- **`hesman install --agent <name>`** is now an alias of `hesman setup --client <name> --yes` and will be removed in the next minor version. `--global` never had an effect and is ignored.

### Changed

- **Project detection:** the server no longer needs a project path in its MCP entry, so one global entry works in every workspace. The project is chosen from, in order: an explicit root (`--project-root`, `HESMAN_PROJECT_ROOT`, `projectRoot` in the config file); the first workspace folder the client reports through MCP `roots` (re-resolved on `notifications/roots/list_changed`; other folders are logged); the nearest directory at or above the working directory that holds a VCS directory or a project manifest. Otherwise the server starts without a project and every tool returns the new `NO_PROJECT` error explaining how to set one. **Behavior change:** a working directory that is not inside a project is no longer indexed, and the home directory or its parents are never picked automatically. The `--project-root` flag, documented but previously ignored by the server, now works.
- **Non-blocking startup:** the server answers the MCP `initialize` handshake and `tools/list` right away (about 0.2 s on a 6,000-file project that takes 10 s to index) instead of after the embedding model load and the full initial index, so clients no longer time out on large repositories or on the first run. The model and the index load in the background: tools answer from what is indexed so far and add `_meta.indexing: { inProgress, filesDone, filesTotal }` while the index is incomplete, `index_status` gains an `indexing` block (`inProgress`, `phase`, `filesDone`, `filesTotal`, `startedAt`, `error`) and `health.embeddingModelError`, and `semantic_search` says whether the model is still loading or failed to load. Shutting down mid-index is clean.
- **Symbol extraction is driven by Tree-sitter tags queries:** TypeScript/JavaScript, Python and Go symbols now come from each grammar's own `tags.scm` (vendored unmodified under `queries/`, attributed in the new `NOTICE` file) through one generic engine, instead of a hand-written table per language. Supporting a language is now a grammar plus a query file. Existing symbols keep their names, kinds, lines and ids, with these differences: a constant initialized with a function (`const f = () => ...`) is a `function` instead of a `variable`; newly indexed are Python module-level assignments (`constant`), abstract classes, class expressions, `namespace` blocks, functions assigned to properties or object keys, and every name of a multi-name Go `const`/`var`; destructuring patterns are no longer indexed as one oddly named variable. Doc comments are stored without their comment markers. Existing indexes are rebuilt automatically on first start (index schema version 4).
- **Tree-sitter runtime:** `web-tree-sitter` is upgraded from `^0.22.6` to `0.25.10`, pinned exactly. The new runtime loads grammars with ABI 13–15 (the old one stopped at 14), which most current upstream grammars need. See [ADR 0001](./docs/adr/0001-grammar-distribution.md).
- **Cursor (user scope):** the global `~/.cursor/mcp.json` entry no longer passes `--project-root ${workspaceFolder}`, because Cursor defines that variable as the folder holding the `mcp.json`, which for the global file may be the home directory. The project scope (`.cursor/mcp.json`) still passes it.
- **`hesman setup` no longer always writes `command: "hesman"`:** see `--command` above. A Hesman that is not on PATH (for example a source checkout without `npm link`) now gets an entry that starts.
- **README quick start** describes the install-from-source path, the only one that works until `hesman-mcp` is published on npm.

### Fixed

- **Parser memory leak:** a new Tree-sitter parser was created for every file and neither parsers nor syntax trees were ever freed, so WASM memory grew with the number of files indexed. One parser per language is now reused and every tree is freed after extraction.
- **VS Code config:** `hesman install --agent vscode` wrote an `mcpServers` object into `.vscode/mcp.json`, which VS Code ignores. The entry is now written under `servers` with `"type": "stdio"`.
- **Generated client entries no longer pin a working directory:** the `cwd` field is gone (and removed from an existing Hesman entry on the next setup), so one user-level entry serves every project.
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
