# Changelog

## Unreleased

### Added

- **`hesman ui [path] [--port <n>] [--no-open]` (dashboard backend):** a local HTTP server on `127.0.0.1` with a JSON API over a project's index, logs and tool calls: `/api/status`, `/api/metrics`, `/api/calls`, `/api/logs`, `/api/graph/search`, `/api/graph/neighborhood`, `/api/graph/files`, `/api/tools` and `POST /api/tools/:name`, which runs a tool through the same handlers, validation and path confinement as MCP. Every API request needs the random token printed with the URL; requests with a foreign `Host` or `Origin` are refused. It opens the index read-only, so it runs next to an MCP server for the same project; `semantic_search` and live indexing progress are not available in that process and `/api/status` says so. The page it serves is a placeholder until the frontend lands. Documented in `docs/CLI.md`; the access rules are in `docs/SECURITY.md`.
- **Server log file:** the MCP server now also writes its log lines (the same JSON lines as on stderr) to `<dataDir>/logs/hesman.log`, or to the `logFile` setting, which was ignored before. The file is rotated at 5 MB with one older file kept (`hesman.log.1`). Nothing is written to stdout.
- **Tool-call log:** every tool call is recorded in `<dataDir>/tool-calls.jsonl` (time, tool, duration, outcome and error code, token counts before and after compression, a shortened preview of the arguments; never the response). The file is rotated at 2 MB with one older file kept, about 20,000 calls in total. Recording cannot fail a call.
- **`hesman setup`:** one command adds Hesman to Claude Code, Claude Desktop, OpenAI Codex CLI, Cursor, Google Antigravity, VS Code (Copilot), Gemini CLI and Windsurf. It detects the installed clients and shows a checklist; `--client <name…>`, `--all`, `--yes`, `--dry-run` (prints the exact change, writes nothing), `--scope user|project` and `--project-root <path>` cover scripted use. It uses `claude mcp add` / `codex mcp add` when those CLIs are on PATH and edits the config file otherwise; Codex `config.toml` is edited in place without touching comments or other tables. Without a terminal and without a choice it prints what it found and exits instead of waiting for input.
- **`hesman setup --command auto|npx|global|absolute`:** chooses what the clients run. `npx` writes `npx -y hesman-mcp@<major>`, `global` writes `hesman`, `absolute` writes the running Node binary plus the installed `dist/index.js`. `auto` (default) decides from how Hesman was started, without the network: from an npx cache → `npx`; `hesman` on PATH is this installation → `global`; otherwise → `absolute`. On macOS and Linux, desktop apps (Claude Desktop, Cursor, Antigravity, VS Code, Windsurf) get the `absolute` entry when `auto` picked a command that, or whose `node`, is outside the standard system directories (nvm, fnm, volta, asdf), with a note to run `hesman setup` again after switching Node versions. `hesman-mcp` is not on npm yet, so an explicit `--command npx` prints that it only works once the package is published.
- **`hesman doctor [--client <name…>] [--json] [--timeout <ms>]`:** read-only diagnosis of every detected client's Hesman entry, with a fix printed for each problem. Per client it checks that the config file parses and has the entry, that the entry is what `hesman setup` would write now (stale absolute paths after a Node switch or a moved checkout, a leftover `cwd`), that the command resolves where the client looks for it (desktop apps without the shell PATH; an `npx` entry while `hesman-mcp` is not on npm), that starting it answers the MCP `initialize` handshake within the timeout (default 5 s, measured time reported), that stdout carries only JSON-RPC, and which project would be indexed (explicit root, working directory or `NO_PROJECT`), saying what cannot be known without the real client. It also checks this installation (entry script, Node version against `engines`, bundled parsers). Exit code 1 when a check fails; `--json` prints one object, documented with `setup` and `remove` in the new `docs/CLI.md`. The server is started with a temporary data directory, so nothing is written into the project.
- **`hesman remove`:** takes the Hesman entry out again and restores the config file byte for byte when nothing else changed since setup.
- **`hesman setup --rules` (opt-in agent usage rules):** writes a 14-line block into the project instruction file each selected client reads (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex CLI and Windsurf, `GEMINI.md` for Gemini CLI and Antigravity, `.cursor/rules/hesman.mdc` for Cursor, `.github/copilot-instructions.md` for VS Code; Claude Desktop is skipped with a note) telling the agent which Hesman tool to call instead of grep or a whole-file read. The block sits between `<!-- hesman:rules:start -->` and `<!-- hesman:rules:end -->`; a second run replaces it in place, a shared file gets it once, and `--dry-run` prints it without writing. Nothing is written without `--rules`; on a terminal without `--yes` setup asks once, default No. Setup lists the changed files, since they are usually committed to git. `hesman remove` now also deletes exactly that block in the current project (or `--project-root`), restoring the file byte for byte and deleting a file that held nothing else. The effect on how often agents call the tools is not measured yet.
- **Text tier — files without a grammar are no longer invisible.** A file whose language has no grammar (`.sql`, `.sh`, `.rb`, `.zig`, `Dockerfile`, `Makefile`, Markdown, YAML, unknown extensions, ...) used to be skipped entirely. It is now indexed as text: blank-line-separated blocks packed into chunks of at most 30 lines. `semantic_search` ranks those chunks with symbols and marks them `kind: "text"`, `precision: "text"` and `language: <label>`; `find_pattern` accepts the label as `language` and marks the response `precision: "text"`; `get_context` reports the label and `precision: "text"`. No symbols are invented, so symbol and call-graph tools are unchanged. `semantic_search` accepts `kind: "text"` and any text-tier label as `language`; `index_status` gains `textTier` (`files`, `chunks`, per-label counts). Binaries (NUL byte in the first 8 KB), lockfiles, minified and generated files, images, archives, bulk data, secrets (`.env*`, keys) and files over 256 KB are not indexed; see "Text tier" in `docs/TOOLS.md`. **Behavior change:** existing indexes are rebuilt once (index schema 3); `indexing.filesTotal` now includes text files; the `language` argument of `semantic_search` is no longer an enum in the tool schema. Measured on this repository: +60 files and +343 chunks next to 173 parsed files, index time 17–19 s -> 28 s, data directory 11.5 MB -> 13.5 MB.
- **Language conformance suite:** `npm run test:conformance` checks every language in the registry against fixtures in `tests/fixtures/languages/<id>/` and an `expected.json` next to them: the grammar loads in the pinned Tree-sitter runtime, every vendored query compiles against it, the fixtures parse, the listed definitions are extracted (name, kind, line, exported, signature, doc comment), `deep` languages yield the listed calls, and the same fixtures indexed through the worker pool reach SQLite. A registry entry without fixtures fails with instructions, and both parts print a per-language pass/fail table (`HESMAN_CONFORMANCE_REPORT=<dir>` also writes it as Markdown and JSON). Registry entries now declare a `tier` (`deep` or `structural`). The suite documents, as known gaps, what it found: `.tsx`/`.jsx` files parse with errors under the TypeScript grammar (one arrow-function component is indexed as a variable), declarations local to an exported TypeScript/JavaScript function and `private` class members are reported as exported, CommonJS `module.exports` is not recognized as an export, and the names of a Python tuple assignment (`A, B = 1, 2`) are not indexed.

- **16 bundled languages (was 3):** Java, C, C++, C#, Rust, PHP, Ruby, Kotlin, Swift, Bash and Lua are now parsed with their own Tree-sitter grammars, and TSX and JavaScript got their own grammars instead of sharing the TypeScript one. The grammars are the `.wasm` assets of each grammar's upstream release, pinned by URL and sha256, committed under `parsers/` (27.3 MB unpacked; the npm tarball grows from 0.50 MB to 2.70 MB gzipped) and attributed in `NOTICE`; symbols come from each grammar's own `tags.scm`, with small Hesman query layers where upstream has gaps. Tiers, stated per language in the README: TypeScript, TSX, JavaScript, Python, Go, Java, C#, Rust, PHP, Kotlin, Swift and Lua are `deep` (symbols and `calls` relations); C, C++, Ruby and Bash are `structural` (symbols only), because the current text-based call extraction does not work for them. Known limits: symbol kinds follow the upstream queries (PHP and Kotlin methods are `function`; Rust and Swift enums and Kotlin interfaces are `class`); in Java and C# a `new X(...)` call is not linked because class and constructor share a name; import relations exist only for ES `import ... from` statements. **Behavior change:** `.tsx` files are stored with `language: "tsx"` and `.js`/`.jsx`/`.mjs`/`.cjs` files with `language: "javascript"` (both were `"typescript"`), so a `language: "typescript"` filter in `semantic_search` or `find_pattern` no longer covers them; JSX now parses without errors, so arrow-function components are indexed as functions; files of the eleven new languages yield symbols instead of text chunks (`.sh`/`.bash` are labelled `bash`, other shells stay `shell`). Existing indexes are rebuilt automatically on first start (index schema version 5).

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
