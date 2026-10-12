# Architecture

## Overview

Hesman is an MCP (Model Context Protocol) server that parses, indexes, and serves code intelligence to AI agents. The system follows a pipeline architecture: file events → parse → index → query, with a 3-layer compression pipeline (compact mode and context pruning are applied today; summarization is not yet). `get_context` measured 89.9% fewer tokens than the whole file with its default ±5 context lines on a 195-line file.

---

## Data Flow

```
File System                    Hesman Server                  AI Agent
    │                              │                             │
    │  ┌──────────────────────┐    │                             │
    ├──│ chokidar (File Watch)│    │                             │
    │  └─────────┬────────────┘    │                             │
    │            │                  │                             │
    │  ┌─────────▼────────────┐    │                             │
    │  │  Worker Pool         │    │                             │
    │  │  (N threads)         │    │                             │
    │  │  Parse + Extract     │    │                             │
    │  └─────────┬────────────┘    │                             │
    │            │                  │                             │
    │  ┌─────────▼────────────┐    │                             │
    │  │  3-Layer Compression │    │    MCP stdio transport      │
    │  │  ┌─────────────────┐ │    │    ◄──────────────────────  │
    │  │  │ Compact Mode    │ │    │                             │
    │  │  ├─────────────────┤ │    │                             │
    │  │  │ Context Pruning │ │    │                             │
    │  │  ├─────────────────┤ │    │                             │
    │  │  │ Summarization   │ │    │                             │
    │  │  └─────────────────┘ │    │                             │
    │  └─────────┬────────────┘    │                             │
    │            │                  │                             │
    │  ┌─────────▼────────────┐    │    ┌──────────────────┐     │
    │  │   Stores             │    │    │  11 Tools        │     │
    │  │  ┌─────────────────┐ │    │    │  - find_symbol   │     │
    │  │  │ SQLite (symbols) │─├────┼───►│  - get_callers   │     │
    │  │  ├─────────────────┤ │    │    │  - semantic_search│    │
    │  │  │ ZVec (vectors)  │─├────┼───►│  - impact_analysis│    │
    │  │  └─────────────────┘ │    │    │  - ...            │     │
    │  └───────────────────────┘    │    └──────────────────┘     │
    │                              │                             │
```

---

## 3-Layer Compression Pipeline

The pipeline is applied at query response time to reduce token consumption for AI agents:

### Layer 1: Compact Mode

Strips non-essential content from code while preserving meaning.

**Level 1 (basic regex):**
- Removes single-line comments (`// ...`)
- Removes block comments (`/* ... */`)
- Collapses consecutive blank lines into one
- Strips trailing whitespace
- Preserves magic comments: `// @ts-ignore`, `// eslint-disable-*`, `// @ts-expect-error`

**Level 2 (AST-aware):**
- All of Level 1, plus:
- Preserves JSDoc blocks (`/** ... */`)
- Strips unused named imports (naive scan)

### Layer 2: Context Pruning

Keeps only relevant lines around a focus symbol, replacing omitted code with markers:

```
// ... (12 lines omitted: unrelated function)
```

Relevance is determined by:
- Focus symbol definition (signature + first/last lines)
- Direct callees within the same file
- Direct callers within the same file
- References within the same file
- Doc comment lines above the focus symbol

Overlapping ranges are merged before output. The pruning uses merge-sort of intervals for O(n log n) performance.

### Layer 3: Smart Summarization (not applied yet)

For call chains, dependency lists, and reference lists, the response compressor builds a `_summary` block:

```json
"_summary": {
  "totalCount": 47,
  "byKind": { "calls": 32, "imports": 8, "extends": 7 },
  "byFile": [{ "filePath": "src/main.ts", "count": 12 }, ...]
}
```

For call chain tools, `_summary` also includes direct vs. transitive counts and a human-readable summary string.

The `_summary` is only added next to the full list, so it never makes a response smaller. Since M0-15 the compressor keeps its changes only when they shrink the payload, so `_summary` is always dropped and these tools return their plain payload with `_meta.reduction` `0.0%` and `_meta.compressed: false`. Replacing long lists with a summary plus the top entries is a backlog item in `tasks/STATUS.md`.

Each response except `index_status` also includes `_meta` with original and compressed token counts, the reduction percentage (never negative), `compressed`, and the active `layers`.

---

## Module Dependency Map

```
src/
├── index.ts                         # Entry point — bootstrap server, config, stores, workers
│
├── config/
│   ├── schema.ts                    # Zod config schema
│   ├── defaults.ts                  # Default configuration values
│   └── loader.ts                    # Config file finder, env/CLI override merging
│
├── cli/
│   ├── commands.ts                  # CLI subcommand implementations (index, status, clean, diag, help)
│   └── install.ts                   # Agent config installer (Claude Desktop, Cursor, VS Code)
│
├── parsers/
│   ├── core.ts                      # Tree-sitter init, file parsing, symbol extraction
│   ├── language-profile.ts          # LanguageProfile interface
│   ├── compact-mode.ts              # Layer 1: compact mode (level 1 & 2)
│   ├── context-pruner.ts            # Layer 2: context pruning
│   ├── summarizer.ts                # Layer 3: symbol summaries, call chain compression
│   ├── chunker.ts                   # Symbol chunker for embedding
│   ├── relation-extractor.ts        # Relations: calls and imports from the syntax tree, extends/implements by regex
│   └── profiles/
│       ├── typescript.ts            # TypeScript/JavaScript language profile
│       ├── python.ts                # Python language profile
│       └── go.ts                    # Go language profile
│
├── indexing/
│   ├── index-coordinator.ts         # Index orchestration — scan, dispatch workers, update stores
│   ├── index-state.ts               # Progress of the background initial index (read by tools)
│   ├── project-scanner.ts           # File discovery with glob/exclusion filtering
│   ├── worker-pool.ts               # Worker thread pool with dispatch/drain/terminate
│   ├── worker.ts                    # Worker thread — parse + extract relations
│   └── file-watcher.ts              # Chokidar-based incremental re-indexing
│
├── stores/
│   ├── sqlite.ts                    # SQLite store — symbols, relations, file hashes, FTS5
│   ├── zvec.ts                      # ZVec vector store — HNSW + FTS hybrid search
│   └── embedding.ts                 # Transformers.js embedding pipeline
│
├── server/
│   ├── mcp-server.ts                # MCP server wrapper — tool registration, stdio transport
│   ├── error-codes.ts               # Error codes and formatError() helper
│   ├── response-compressor.ts       # Response-level compression (adds _meta; _summary only if smaller)
│   └── tools/
│       ├── index.ts                 # Tool registration hub
│       ├── find-symbol.ts           # find_symbol tool
│       ├── get-file-structure.ts    # get_file_structure tool
│       ├── get-references.ts        # get_references tool
│       ├── get-callers.ts           # get_callers tool
│       ├── get-callees.ts           # get_callees tool
│       ├── get-context.ts           # get_context tool
│       ├── semantic-search.ts       # semantic_search tool
│       ├── list-dependencies.ts     # list_dependencies tool
│       ├── impact-analysis.ts       # impact_analysis tool
│       ├── find-pattern.ts          # find_pattern tool
│       └── index-status.ts          # index_status tool
│
├── monorepo/
│   ├── detector.ts                  # Workspace detection (pnpm, lerna, nx, turbo, npm)
│   └── coordinator.ts               # Cross-package indexing and relation discovery
│
├── diagnostics/
│   └── metrics.ts                   # Runtime metrics — query latency, cache, memory snapshots
│
└── utils/
    └── logger.ts                    # Pino logger setup
```

---

## Store Layout

### SQLite (`symbols.db`)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `symbols` | Extracted symbols | `id` (PK), `name`, `kind`, `file_path`, `start_line`, `end_line`, `signature`, `parent_id`, `is_exported`, `language` |
| `relations` | Symbol relations | `from_id` (a symbol id, or `module:<hash>` for a call made outside every function), `to_id`, `kind` (calls/imports/extends/...), `file_path`, `line`, `col`, `to_name` (callee name), `receiver` (of a call: null for `f()`, the receiver's last name for `a.f()`), `names` (bound by an import; a module name is prefixed with `*`) |
| `file_hashes` | Content-based change detection | `file_path` (PK), `sha256`, `updated_at` |
| `fts_symbols` | FTS5 full-text search index | Virtual table over `symbols(name, signature, doc_comment)` |
| `metadata` | Index stats | `key`, `value` — stores `total_files`, `total_symbols`, `last_index_time` |

A `symbols.db` that SQLite reports as corrupt is moved aside as `symbols.db.corrupt` (one generation is kept) and the index is rebuilt from the project files, at server start and by `hesman index`; `hesman ui` opens the index read-only and only reports the problem.

### ZVec (`zvec/` directory)

| Collection | Purpose | Index Type |
|------------|---------|------------|
| `code_search` | Semantic + keyword search | HNSW (cosine) for 384-dim embeddings + FTS on `code` and `docComment` fields |

---

## Worker Pool Design

```
                    ┌─────────────────────────────┐
                    │      WorkerPool              │
                    │                              │
                    │    ┌─── Worker 0 ───┐        │
                    │    │ Parse file A    │        │
                    │    └────────────────┘        │
                    │    ┌─── Worker 1 ───┐        │
                    │    │ Parse file B    │        │
                    │    └────────────────┘        │
                    │    ┌─── Worker N ───┐        │
                    │    │ Parse file C    │        │
                    │    └────────────────┘        │
                    │                              │
                    │    Task Queue (FIFO)          │
                    │    [fileD, fileE, fileF]      │
                    └──────────────────────────────┘
```

- **Size**: `cpus().length - 1` when set to `0` (auto), minimum 1
- **Dispatch**: Tasks distributed to idle workers; remaining tasks wait in FIFO queue
- **Drain**: Polls `busyWorkers` set until empty, then resolves
- **Terminate**: `drain()` first, then call `worker.terminate()` on each thread
- **Crash recovery**: Worker exit codes `!= 0` trigger automatic restart with fresh worker
- **Pause**: `pool.pause()` stops dispatching new tasks; resume by calling `flushQueue()`

---

## Monorepo Layout

The monorepo support in Hesman detects workspace structures and indexes all packages into a shared store:

```
project-root/
├── hesman.config.json              # Shared config
├── package.json                    # workspaces: ["packages/*"]
├── packages/
│   ├── pkg-a/
│   │   ├── package.json
│   │   └── src/
│   │       └── index.ts
│   └── pkg-b/
│       ├── package.json
│       └── src/
│           └── index.ts
└── .hesman/                        # Shared SQLite + ZVec stores
    ├── symbols.db
    └── zvec/
```

Workspace detection supports: pnpm (`pnpm-workspace.yaml`), lerna (`lerna.json`), nx (`nx.json`), turbo (`turbo.json`), npm workspaces (`package.json/workspaces`).

After all packages are indexed, cross-package relations are discovered by resolving import dependencies between packages.

---

## Key Design Decisions

1. **No LSP dependency** — Tree-sitter provides language-agnostic parsing without starting language servers
2. **Query-based call and import extraction** — calls and imports are the `@reference.call` / `@reference.import` matches of each language's query layers (`TagsQuery.relations`), attributed to the innermost enclosing function, method, class or function-valued variable (otherwise to the module) and linked by name after indexing (`call-resolver.ts`): own file → the import that binds the name → imported files → same directory → unique in the project, restricted by visibility (a symbol another file cannot reach is no cross-file target) and by the receiver (a member call targets a method or a property function); an ambiguous call stays unresolved. `extends` / `implements` are still matched by regex
3. **Response-level compression** — Applied per-response rather than at the parser level so the original data is always available for non-MCP use
4. **Content-hash incremental indexing** — Files are re-parsed only when their SHA-256 hash changes, detected during scanning
5. **Single SQLite store for all packages** — In monorepo mode, all packages share one database; package isolation is achieved via the `file_path` column
