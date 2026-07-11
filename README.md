# Hesman MCP Server

[![CI](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Hesman** is a next-generation MCP (Model Context Protocol) server that connects AI agents to codebases with deep code intelligence — parsing, semantic search, knowledge graphs, and impact analysis, all running locally without external API dependencies.

## Quick Start

```bash
# 1. Install globally
npm install -g hesman-mcp

# 2. Run the server in your project root
hesman

# 3. Config for Claude Desktop (automatic)
hesman install --agent claude
```

That's it. Point Claude Desktop (or any MCP host) at `hesman` and start asking questions about your codebase.

---

## Features

### Code Intelligence

- **Tree-sitter parsing** for TypeScript, JavaScript, Python, and Go — 158 language-capable architecture, no LSP dependency
- **Symbol index** on SQLite — exact, fuzzy (FTS5), and prefix lookup under 1ms
- **Call graph** — traverse callers and callees with configurable depth up to 3 levels
- **Relation extraction** — calls, imports, extends, implements, and type references
- **Monorepo-aware** — auto-detects pnpm, lerna, nx, turbo, and npm workspaces

### 98% Token Reduction

- **3-layer compression pipeline**: compact mode (strip comments/blanks), context pruning (keep only relevant lines), smart summarization
- **`_summary` blocks** on list responses: `_summary` aggregates `byKind`, `byFile`
- **Pagination via `cursor`** — avoid dumping large result sets
- **AST-aware compression** (level 2): preserves JSDoc, strips unused imports

### Production Ready

- **Worker pool** with automatic thread count (parallel indexing)
- **File watcher** via chokidar — incremental re-indexing on change
- **Graceful shutdown** — drains active work, flushes stores, terminates workers
- **Diagnostics CLI** — `hesman diag` prints memory, store stats, cache, and pool state
- **CI-tested** across Ubuntu, macOS, Windows on Node 20 and 22
- **Memory capped at 350MB** for 1M+ line projects

---

## Tools

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `find_symbol` | Look up symbols by name (exact/fuzzy/prefix) | `name`, `kind`, `matchMode`, `topK` | Symbol list with file, line, signature |
| `get_file_structure` | List all symbols in a file | `filePath`, `includeNested` | Hierarchical symbol tree with nested children |
| `get_references` | Find all usages of a symbol | `symbolId`, `referenceKind`, `topK`, `cursor` | Reference list with `_summary` |
| `get_callers` | Traverse call graph upward | `symbolId`, `maxDepth`, `topK` | Callers with depth, `_summary` |
| `get_callees` | Traverse call graph downward | `symbolId`, `maxDepth`, `topK` | Callees with depth, `_summary` |
| `get_context` | Focused code around a location | `filePath`, `startLine`, `endLine`, `contextLines`, `mode` | Compacted/pruned code with symbols in range |
| `semantic_search` | Natural-language code search | `query`, `topK`, `filePattern`, `language`, `kind` | Ranked results with scores |
| `list_dependencies` | File/project dependencies | `filePath`, `direction` | Import list with `_summary` |
| `impact_analysis` | What breaks if a symbol changes | `symbolId`, `changeType`, `newName`, `maxFiles` | Categorized (must_fix/should_review/info) |
| `find_pattern` | Search by structural pattern | `pattern`, `language`, `filePattern`, `topK` | Matches with named captures (`$NAME`, `$$$ARGS`) |
| `index_status` | Indexing health and statistics | (none) | File/symbol counts, store health |

See [docs/TOOLS.md](./docs/TOOLS.md) for full input/output schemas and examples.

---

## Supported Languages

| Language | Extensions | Status |
|----------|-----------|--------|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | Full |
| Python | `.py`, `.pyw`, `.pyi` | Full |
| Go | `.go` | Full |

Adding a new language requires creating a `LanguageProfile` with Tree-sitter node types, relation queries, signature and doc comment extractors. See [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) for the profile guide.

---

## Configuration

Create a `hesman.config.json` in your project root:

```json
{
  "projectRoot": ".",
  "workers": 4,
  "watchMode": true,
  "languages": ["*"],
  "ignore": ["legacy/**"],
  "semanticSearch": {
    "enabled": true,
    "defaultTopK": 10,
    "maxTopK": 50,
    "embeddingModel": "Xenova/all-MiniLM-L6-v2"
  },
  "logLevel": "info",
  "dataDir": ".hesman"
}
```

Configuration is loaded with layered overrides: defaults → config file → env vars → CLI flags.

| Env Variable | CLI Flag | Description |
|-------------|----------|-------------|
| `HESMAN_PROJECT_ROOT` | | Project root path |
| `HESMAN_WORKERS` | `--workers N` | Worker thread count (0 = auto) |
| `HESMAN_LOG_LEVEL` | `--log-level <level>` | trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir <path>` | Data directory |
| `HESMAN_WATCH_MODE` | `--watch-mode <bool>` | Enable/disable file watching |
| | `--no-watch` | Disable file watching |
| | `--no-semantic` | Disable semantic search |
| | `--batch-size N` | Index batch size |

---

## CLI Reference

```
hesman                    Run the MCP server (stdio transport)
hesman index [path]       Index a project (default: current directory)
hesman status [path]      Show indexing status
hesman clean [path]       Delete .hesman/ data directory
hesman clean --force      Skip confirmation prompt
hesman clean --dry-run    Preview what would be deleted
hesman diag [path]        Print diagnostics (memory, store, pool, cache)
hesman diag --json        JSON format output
hesman install --agent <claude|cursor|vscode> [--global]
hesman --version, -v      Print version
hesman --help, -h         Show help
```

---

## Architecture

```
           ┌─────────────────────────────────────────────────────┐
           │                    AI Agent (Claude, etc.)          │
           │                        │  MCP stdio                 │
           └────────────────────────┼────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────────┐
           │              Hesman MCP Server                      │
           │                        │                            │
           │    ┌───────────────────┼───────────────────┐        │
           │    │       3-Layer Compression Pipeline    │        │
           │    │  Layer 1: Compact Mode (strip cmts)   │        │
           │    │  Layer 2: Context Pruning (keep rel)  │        │
           │    │  Layer 3: Smart Summarization         │        │
           │    └───────────────────────────────────────┘        │
           │                                                    │
           │    ┌──────────┐  ┌──────────┐  ┌──────────┐       │
           │    │  SQLite  │  │  ZVec    │  │  Worker  │       │
           │    │  Store   │  │  Vector  │  │  Pool    │       │
           │    │ (symbols)│  │ (search) │  │ (index)  │       │
           │    └──────────┘  └──────────┘  └──────────┘       │
           │         │              │              │            │
           │    ┌────┴──────────────┴──────────────┴────┐       │
           │    │        File Watcher (chokidar)        │       │
           │    └───────────────────────────────────────┘       │
           └────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full architecture document including module dependencies and store layout.

---

## Requirements

- **Node.js** >= 20.0.0
- **npm** (or pnpm / yarn)
- **Memory**: ~100MB idle, ~350MB under load
- **Disk**: ~80MB for embedding model cache (one-time download)

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Minh Do
