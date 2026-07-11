# Hesman MCP Server

[![CI](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Hesman** is a next-generation MCP (Model Context Protocol) server that gives AI coding agents deep understanding of your codebase — symbols, call graphs, dependencies, and semantic search — while cutting token usage by up to **98%**. Everything runs locally. No external APIs. No LSP servers.

---

## Table of Contents

- [Why Hesman?](#why-hesman)
- [Quick Start](#quick-start)
- [Features](#features)
- [How Token Reduction Works](#how-token-reduction-works)
- [Installation & Setup](#installation--setup)
- [Tools Reference](#tools-reference)
- [Configuration](#configuration)
- [CLI Reference](#cli-reference)
- [Supported Languages](#supported-languages)
- [Architecture](#architecture)
- [Development Setup](#development-setup)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [License](#license)

---

## Why Hesman?

AI coding agents are powerful but expensive. Every line of code they read costs tokens. Sending an entire file when the agent only needs one function wastes context and money.

Hesman solves this by:

- **Serving only what the agent needs** — a focused function, its callers, its callees, or the symbols impacted by a change.
- **Compressing every response** — a 3-layer pipeline strips comments, prunes irrelevant code, and summarizes large result sets.
- **Replacing raw dumps with summaries** — instead of 200 references in a JSON array, the agent gets a `_summary` block with counts grouped by kind and file.
- **Running 100% locally** — no API keys, no network calls, no latency from external services. Your code never leaves your machine.

The result: agents work faster, cost less, and reason more accurately because they see the right code, not all the code.

---

## Quick Start

```bash
# 1. Install globally
npm install -g hesman-mcp

# 2. Run the server inside your project
cd my-project
hesman

# 3. Register with your AI agent (Claude Desktop, Cursor, VS Code)
hesman install --agent claude
```

That's it. Once the initial indexing finishes (a few seconds for most projects), your AI agent can query your codebase through Hesman's 11 tools.

---

## Features

### Code Intelligence

| Capability | Description |
|---|---|
| **Symbol lookup** | Find functions, classes, methods by name — exact, fuzzy, or prefix match (< 1ms) |
| **Call graph traversal** | Walk callers and callees up to 3 levels deep |
| **Reference tracking** | Find every usage of a symbol across the codebase |
| **Impact analysis** | See what breaks if you rename, delete, or change a symbol's signature |
| **Semantic search** | Describe what you're looking for in natural language and find matching code |
| **Structural search** | Find code patterns like `console.$METHOD($$$ARGS)` with named captures |
| **Dependency analysis** | See what a file imports and what imports from it |
| **Context windows** | Get focused, compacted code around any location in a file |

### Token Reduction (up to 98%)

| Layer | Technique | Typical Savings |
|---|---|---|
| **Compact mode** | Strips comments, blank lines, trailing whitespace; removes unused imports | 40–60% |
| **Context pruning** | Keeps only lines relevant to the queried symbol, replaces omitted code with markers | 50–80% (on top of compact) |
| **Smart summarization** | Replaces large result arrays with aggregated `_summary` blocks; compresses call chains | 70–90% (on list tools) |

Every response includes `_meta` showing exactly how many tokens were saved.

### Production Ready

- **Worker pool** — parallel indexing across CPU cores, auto-sized by default
- **File watching** — incremental re-indexing on file changes via chokidar
- **Graceful shutdown** — drains active work, flushes stores, terminates workers cleanly
- **Content-hash indexing** — files are re-parsed only when their content actually changes
- **Monorepo support** — auto-detects pnpm, lerna, nx, turbo, and npm workspaces
- **Diagnostics** — `hesman diag` prints memory, store stats, pool state, and cache metrics
- **CI-tested** — runs on Ubuntu, macOS, and Windows with Node 20 and 22

---

## How Token Reduction Works

### Layer 1: Compact Mode

Before:
```typescript
// This function calculates the total price
// including tax and shipping
function calculateTotal(
  items: CartItem[],      // shopping cart items
  taxRate: number,        // local tax rate
): number {
  let total = 0;

  // Sum up item prices
  for (const item of items) {
    total += item.price * item.quantity;
  }

  // Apply tax
  total = total * (1 + taxRate);

  return total;
}
```

After (Level 1):
```typescript
function calculateTotal(
  items: CartItem[],
  taxRate: number,
): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  total = total * (1 + taxRate);
  return total;
}
```

After (Level 2 — AST-aware, preserves JSDoc):
```typescript
/**
 * Calculates the total price including tax.
 * @param items - Shopping cart items
 * @param taxRate - Local tax rate as decimal (e.g., 0.08)
 */
function calculateTotal(items: CartItem[], taxRate: number): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  total = total * (1 + taxRate);
  return total;
}
```

### Layer 2: Context Pruning

When an agent queries `get_context` for a specific symbol, Hesman returns only the relevant code:

```typescript
// ... (45 lines omitted: unrelated imports and helper functions)

/**
 * Processes the incoming webhook payload.
 */
export async function handleWebhook(payload: WebhookPayload): Promise<Result> {
  // ... (function body)
}

// ... (120 lines omitted: unrelated class definitions)
```

Pruning keeps: the focus symbol's definition, its doc comment, direct callers and callees within the same file, and in-file references — everything else is replaced with a count marker.

### Layer 3: Smart Summarization

Instead of dumping 200 references in a JSON array:

```json
{
  "_summary": {
    "totalCount": 200,
    "byKind": { "calls": 145, "imports": 38, "extends": 12, "type_ref": 5 },
    "byFile": [
      { "filePath": "src/services/payment.ts", "count": 34 },
      { "filePath": "src/controllers/checkout.ts", "count": 28 }
    ]
  }
}
```

The agent can then request details for specific files or kinds — paginated via `cursor`.

---

## Installation & Setup

### Prerequisites

- **Node.js** ≥ 20.0.0
- **npm** (or pnpm / yarn)

### Install from npm

```bash
npm install -g hesman-mcp
```

### Install from Source

```bash
git clone https://github.com/do-minh/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Download Tree-sitter WASM parsers
npm run build              # Compile TypeScript
npm link                   # Make `hesman` available globally
```

### Register with AI Agents

```bash
# Claude Desktop (auto-detects config path)
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code (with Copilot or Cline)
hesman install --agent vscode

# Use --global to write to user-level config instead of project-level
hesman install --agent claude --global
```

After installation, restart your AI agent and Hesman will be available as an MCP server.

### Manual MCP Configuration

Add this to your agent's MCP config file:

```json
{
  "mcpServers": {
    "hesman": {
      "command": "hesman",
      "args": ["--project-root", "/path/to/your/project"],
      "env": {}
    }
  }
}
```

---

## Tools Reference

Hesman exposes **11 tools** over MCP stdio transport. Every response includes a `_meta` block with token savings and, where applicable, a `_summary` block aggregating results.

### Code Navigation

| Tool | What it does | Key inputs |
|---|---|---|
| `find_symbol` | Find symbols by name with exact, fuzzy, or prefix matching | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Get a hierarchical tree of all symbols in a file | `filePath`, `includeNested` |
| `get_references` | Find all usages of a symbol across the codebase | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Get compacted code around a specific location | `filePath`, `startLine`, `contextLines`, `mode` |

### Call Graph

| Tool | What it does | Key inputs |
|---|---|---|
| `get_callers` | Find all functions that call a given symbol (up to 3 levels deep) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Find all functions called by a given symbol (up to 3 levels deep) | `symbolId`, `maxDepth`, `topK` |

### Analysis

| Tool | What it does | Key inputs |
|---|---|---|
| `impact_analysis` | Categorize what breaks if a symbol changes (rename/delete/signature change) | `symbolId`, `changeType` |
| `list_dependencies` | Show what a file imports, or what imports from it | `filePath`, `direction` |
| `semantic_search` | Search code by natural language description | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Search by structural pattern with named captures (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Status

| Tool | What it does |
|---|---|
| `index_status` | Report indexing health: file count, symbol count, store status, pending files |

For full input/output schemas with examples, see **[docs/TOOLS.md](./docs/TOOLS.md)**.

---

## Configuration

Create a `hesman.config.json` in your project root (all fields optional):

```json
{
  "projectRoot": ".",
  "workers": 0,
  "watchMode": true,
  "languages": ["*"],
  "ignore": ["node_modules/**", "dist/**", ".git/**", "legacy/**"],
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

### Configuration Precedence

Settings are resolved in this order (later overrides earlier):

1. **Defaults** — built into Hesman
2. **`hesman.config.json`** — project-level config file
3. **Environment variables** — e.g., `HESMAN_WORKERS=4`
4. **CLI flags** — e.g., `--workers 4`

### Environment Variables

| Variable | Equivalent | Description |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Path to the project to index |
| `HESMAN_WORKERS` | `--workers N` | Worker thread count (0 = auto-detect) |
| `HESMAN_LOG_LEVEL` | `--log-level` | One of: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Directory for index data (default: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Enable/disable file watching (true/false) |

### CLI Flags

| Flag | Description |
|---|---|
| `--project-root <path>` | Project root directory |
| `--workers <N>` | Number of worker threads (0 = auto) |
| `--log-level <level>` | Logging level |
| `--data-dir <path>` | Data directory path |
| `--watch-mode` | Enable file watching |
| `--no-watch` | Disable file watching |
| `--no-semantic` | Disable semantic search |
| `--batch-size <N>` | Files per indexing batch |

---

## CLI Reference

```
hesman                         Run the MCP server over stdio (default)
hesman index [path]            Index a project without starting the server
hesman status [path]           Show indexing progress and statistics
hesman clean [path]            Delete the .hesman/ data directory
hesman clean --force           Skip confirmation prompt
hesman clean --dry-run         Preview what would be deleted without removing
hesman diag [path]             Print diagnostics: memory, store stats, pool, cache
hesman diag --json             Output diagnostics as JSON
hesman install --agent <name>  Write MCP config for Claude Desktop, Cursor, or VS Code
hesman install --global        Write to user-level config instead of project-level
hesman --version, -v           Print version number
hesman --help, -h              Show help text
```

---

## Supported Languages

| Language | Extensions | Status |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | Full support |
| Python | `.py`, `.pyw`, `.pyi` | Full support |
| Go | `.go` | Full support |

The architecture supports up to **158 languages** via Tree-sitter. Adding a new language requires implementing a `LanguageProfile` — see the [Contributing Guide](./docs/CONTRIBUTING.md) for step-by-step instructions.

---

## Architecture

```
                         ┌──────────────────────────────────────┐
                         │         AI Agent (Claude, etc.)       │
                         │              │  MCP stdio              │
                         └──────────────┼─────────────────────────┘
                                        │
                         ┌──────────────┼─────────────────────────┐
                         │       Hesman MCP Server                │
                         │              │                          │
                         │   ┌──────────┴──────────────────────┐  │
                         │   │     3-Layer Compression Pipeline │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Compact Mode            │  │  │
                         │   │  │    Strip comments/blanks    │  │  │
                         │   │  │ 2. Context Pruning         │  │  │
                         │   │  │    Keep only relevant lines │  │  │
                         │   │  │ 3. Smart Summarization     │  │  │
                         │   │  │    Aggregate & compress     │  │  │
                         │   │  └────────────────────────────┘  │  │
                         │   └───────────────────────────────────┘  │
                         │                                          │
                         │   ┌──────────┐ ┌──────────┐ ┌─────────┐ │
                         │   │  SQLite  │ │   ZVec   │ │ Worker  │ │
                         │   │  Store   │ │  Vector  │ │  Pool   │ │
                         │   │ (symbols)│ │ (search) │ │ (index) │ │
                         │   └────┬─────┘ └────┬─────┘ └────┬────┘ │
                         │        │            │            │       │
                         │   ┌────┴────────────┴────────────┴────┐  │
                         │   │     File Watcher (chokidar)       │  │
                         │   └───────────────────────────────────┘  │
                         └──────────────────────────────────────────┘
```

**Core data pipeline:** File changes (chokidar) → Tree-sitter parse (AST + symbols) → SQLite index + ZVec embeddings → Compressed MCP responses

**Key design decisions:**
- **No LSP dependency** — Tree-sitter provides language-agnostic parsing without running language servers
- **Content-hash incremental indexing** — files are re-parsed only when SHA-256 changes
- **Response-level compression** — original data stays intact; compression is applied at the response boundary
- **Single SQLite database per project** — even in monorepos, all packages share one store with `file_path` isolation

For the full architecture document including module dependencies, store schemas, and worker pool design, see **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

---

## Development Setup

### Prerequisites

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Getting Started

```bash
# Clone and install
git clone https://github.com/do-minh/hesman-mcp.git
cd hesman-mcp
npm install

# Download Tree-sitter WASM parsers
npm run download:parsers

# Run in development mode (hot reload)
npm run dev

# Build for production
npm run build
```

### Code Quality

```bash
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run format       # Prettier formatting
```

### Running Tests

```bash
npm test                  # Run all tests (unit + integration)
npm run test:watch        # Watch mode for development
npm run test:e2e          # End-to-end tests (starts full server)
npm run test:perf         # Performance benchmarks
```

### Performance Targets

| Benchmark | Target |
|---|---|
| Index throughput | ≥ 500 files/sec |
| `find_symbol` (exact) | < 1ms |
| `find_symbol` (fuzzy) | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |
| Memory (after index) | < 350MB |

For the full contributing guide including how to add new languages, see **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**.

---

## Requirements

| Resource | Minimum |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Memory (idle)** | ~100 MB |
| **Memory (under load)** | ~350 MB |
| **Disk** | ~80 MB (one-time embedding model download) |
| **Network** | Only for initial `npm install`; zero runtime network calls |

The embedding model (`all-MiniLM-L6-v2`) is downloaded on first use and cached indefinitely in the Transformers.js cache directory.

---

## Documentation

| Document | Content |
|---|---|
| [README.md](./README.md) | Project overview, setup, and configuration (this file) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Full architecture: data flow, module map, store schemas, worker pool design |
| [docs/TOOLS.md](./docs/TOOLS.md) | Complete input/output schemas for all 11 tools with examples |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Development setup, test guide, language profile authoring, PR checklist |
| [CHANGELOG.md](./CHANGELOG.md) | Version history and changes |

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Minh Do
