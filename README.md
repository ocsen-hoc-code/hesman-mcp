# Hesman MCP Server

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **Read this in:** [English](./README.md) | [Tiếng Việt](./docs/i18n/README.vi.md) | [Русский](./docs/i18n/README.ru.md) | [Deutsch](./docs/i18n/README.de.md) | [Français](./docs/i18n/README.fr.md) | [中文](./docs/i18n/README.zh.md) | [日本語](./docs/i18n/README.ja.md) | [العربية](./docs/i18n/README.ar.md) | [Español](./docs/i18n/README.es.md) | [Português](./docs/i18n/README.pt.md)

**Hesman** is a next-generation MCP (Model Context Protocol) server that gives AI coding agents deep understanding of your codebase — symbols, call graphs, dependencies, and semantic search — with answers shaped to cost few tokens: on this repository `get_context` returns 80–96% fewer tokens than the whole file, and lists of callers or references are 66–72% smaller than plain JSON (see [Measured on this repository](#measured-on-this-repository)). Everything runs on your machine: no external APIs, no LSP servers, and your code is never sent anywhere.

---

## Table of Contents

- [Why Hesman?](#why-hesman)
- [Quick Start](#quick-start)
- [Features](#features)
- [How Token Reduction Works](#how-token-reduction-works)
- [Installation & Setup](#installation--setup)
- [Dashboard](#dashboard)
- [Uninstalling](#uninstalling)
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
- **Compacting and pruning code** — `get_context` strips comments and blank lines and returns only the lines around the focus location instead of the whole file.
- **Compact lists** — callers, callees, references, symbols and file outlines come back as rows under named columns, grouped by file, with project-relative paths; no row is dropped. A response is never larger than its plain payload (see [Token Reduction Pipeline](#token-reduction-pipeline)).
- **Running on your machine** — no API keys, no external service, no latency from one. Your code never leaves your machine. The only downloads are the embedding model on first use and the grammars of on-demand languages; both can be turned off (`--no-semantic`, `HESMAN_GRAMMARS_OFFLINE=1`).
- **Measurable savings** — every tool response except `index_status` includes `_meta.reduction` showing exactly how many tokens were saved vs. raw output.

The result: agents work faster, cost less, and reason more accurately because they see the right code, not all the code.

---

## Quick Start

`hesman-mcp` is not on the npm registry yet, so today Hesman is installed from source:

```bash
# 1. Get and build Hesman (Node.js ≥ 20)
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers
npm run build

# 2. Register it with your AI clients (detects Claude Code, Cursor, VS Code, Codex, …)
node dist/index.js setup
```

Restart the client and open a project. `setup` writes the launch command that fits how Hesman is installed (here: absolute paths to `node` and `dist/index.js`, so nothing has to be on PATH); see [Launch command](#launch-command).

After the package is published, the whole quick start becomes one line:

```bash
npx -y hesman-mcp setup   # only once hesman-mcp is published on npm
```

The server answers your agent immediately and indexes in the background (a few seconds for most projects): the 11 tools work right away, mark results with `_meta.indexing` while the index is still incomplete, and `index_status` reports the progress.

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

### Token Reduction Pipeline

Hesman reduces tokens in three ways. Every response reports its actual savings in `_meta.reduction`, and a response is never larger than its plain payload.

| Layer | Technique | Measured savings | Applies to |
|---|---|---|---|
| **Compact mode** | Strips comments, blank lines, trailing whitespace | 0–16% of a code excerpt, depending on how many comments and blank lines it has (`mode: "full"` vs. `"compact"`) | `get_context` |
| **Context pruning** | Returns a line range around the focus location instead of the file | 96.0% with the default ±5 lines, 79.7% with ±40 lines (514-line file); 0% when the whole file is requested | `get_context` |
| **Compact lists** | Rows under named columns, grouped by file, project-relative paths | 66–72% for callers, callees and references; 35–41% for symbol lists, file outlines, dependencies and impact analysis | `find_symbol`, `get_references`, `get_callers`, `get_callees`, `get_file_structure`, `list_dependencies`, `impact_analysis` |

`find_pattern` and `semantic_search` return their plain payload (`_meta.reduction: "0.0%"`). The numbers are from this repository; see [Measured on this repository](#measured-on-this-repository) for the full table and how to reproduce it. The `_meta.reduction` field in every response reports exact savings for your workload.

### Production Ready

- **Worker pool** — parallel indexing across CPU cores, auto-sized by default
- **File watching** — incremental re-indexing on file changes via chokidar
- **Graceful shutdown** — drains active work, flushes stores, terminates workers cleanly
- **Content-hash indexing** — files are re-parsed only when their content actually changes
- **Monorepo support** — auto-detects pnpm, lerna, nx, turbo, and npm workspaces
- **Diagnostics** — `hesman diag` prints memory, store stats, pool state, and cache metrics
- **Tested locally** — the full test suite, including end-to-end tests through the real server, runs on macOS; Linux and Windows are not verified yet

---

## How Token Reduction Works

### Layer 1: Compact Mode

Strips comments, blank lines, and trailing whitespace while preserving magic comments (`// @ts-ignore`, `// eslint-disable-*`).

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

After:
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

### Layer 2: Context Pruning

`get_context` does not return the whole file. It returns the requested line range plus `contextLines` lines above and below it (default 5, maximum 200), then applies compact mode to that excerpt. `_meta.reduction` compares the result with the whole file, and `_meta.layers` lists what was applied (`compact`, `prune`).

Pruning is by line range only: it does not follow callers or callees. To read what a function calls or what calls it, ask `get_callees` / `get_callers` for the locations and then `get_context` for each.

### Layer 3: Compact Lists

A list answer repeats the same things in every row: a long file path, the field names, values that never change. The compact shape writes each of them once: the field names in `columns`, the path once per file, relative to the project. This is a real `get_callers` answer:

```json
{
  "format": "compact",
  "columns": ["symbolId", "name", "kind", "line", "depth", "callLine", "callFile"],
  "files": [
    { "file": "src/indexing/file-watcher.ts", "rows": [["a182668c09c39b47", "scan", "method", 78, 1, 79, null]] }
  ],
  "_meta": { "originalTokens": 101, "compressedTokens": 54, "reduction": "46.5%", "compressed": true, "layers": ["group", "columns", "paths"] }
}
```

No row is dropped and nothing is summarized away; `symbolId`, the relative `file` and `line` can be passed straight to the other tools. `get_file_structure` and `list_dependencies` use one flat `rows` list. When the compact shape would not be smaller (an empty list, a single row), the plain payload is returned. Pass `format: "full"` to any of these tools to get the plain objects with absolute paths. Long lists are fetched in pages with `topK` and, for `get_references`, `cursor`.

### Measuring Savings

Every tool response except `index_status` includes a `_meta` block with actual token savings:

```json
{
  "_meta": {
    "originalTokens": 4782,
    "compressedTokens": 190,
    "reduction": "96.0%",
    "compressed": false,
    "layers": ["prune"]
  }
}
```

This example is a real `get_context` call (default ±5 lines, compact mode) on a 514-line file: the excerpt is already compacted by the tool, so only the `prune` layer is listed, and `compressed: false` means the response compressor had nothing further to remove. The `_meta.reduction` field measures against the original full-file token count, giving you the true end-to-end savings. Responses that would not shrink are returned as-is with `reduction: "0.0%"`; it is never negative. Audit exactly how much Hesman saves in your real workloads by checking `_meta.reduction` on any tool response.

---

## Installation & Setup

### Prerequisites

- **Node.js** ≥ 20.0.0
- **npm** (or pnpm / yarn)

### Install from Source

This is the path that works today.

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Download Tree-sitter WASM parsers
npm run build              # Compile TypeScript
npm link                   # Optional: make `hesman` available on PATH
```

Without `npm link`, use `node /path/to/hesman-mcp/dist/index.js` wherever this README says `hesman`.

### Install from npm (after the package is published)

`hesman-mcp` is not on the npm registry yet. Once it is:

```bash
npx -y hesman-mcp setup     # no install: clients start Hesman through npx
npm install -g hesman-mcp   # or a global install that puts `hesman` on PATH
```

### Register with AI Agents

```bash
hesman setup                         # checklist of the clients found on this machine
hesman setup --yes                   # no questions: configure every detected client
hesman setup --client cursor vscode  # configure specific clients
hesman setup --dry-run --all         # print the exact change per client, write nothing
hesman remove                        # undo: take Hesman out of every client again
```

| Client | `--client` | What `hesman setup` changes (user scope) | `--scope project` |
|---|---|---|---|
| Claude Code | `claude-code` | runs `claude mcp add --scope user hesman -- <launch command>`; without the CLI, edits `~/.claude.json` | `.mcp.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` | — |
| OpenAI Codex CLI | `codex` | runs `codex mcp add hesman -- <launch command>`; without the CLI, edits `~/.codex/config.toml` | `.codex/config.toml` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Google Antigravity | `antigravity` | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| VS Code (Copilot) | `vscode` | `mcp.json` in the VS Code user directory | `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Windsurf | `windsurf` | `~/.config/devin/mcp_config.json` | — |

- Only the `hesman` entry is touched. A changed file is first copied to `<file>.hesman.bak`, and `hesman remove` restores it byte for byte when nothing else changed in between.
- The entry holds no project path: Hesman finds the project itself (see below). Two exceptions: **Claude Desktop** has no workspace, so its entry pins one project (the current directory, or `--project-root <path>`), and **Cursor** gets `--project-root ${workspaceFolder}` in the project scope only (in the global `~/.cursor/mcp.json` that variable may be your home directory, so the global entry names no project).
- For **Antigravity** and **Windsurf**, how the project is passed to the server is not documented; `hesman setup` prints a note asking you to check after the first start.
- Config files with comments (JSONC) are not edited: `hesman setup` reports them and leaves them untouched.
- `hesman install --agent <name>` still works as a deprecated alias of `hesman setup --client <name> --yes`.

After setup, restart the client and Hesman will be available as an MCP server.

### Agent usage rules (opt-in)

An installed MCP server is not automatically a used one: agents often keep reaching for grep and whole-file reads. `hesman setup --rules` also writes a short block (14 lines) into the instruction file each selected client reads in the **current project**, saying which Hesman tool answers which question. Whether it changes how often an agent calls the tools has not been measured yet.

```bash
hesman setup --client claude-code codex --rules   # run inside the project
hesman setup --all --rules --dry-run              # print the block and the files, write nothing
hesman remove                                     # also deletes the block again
```

| Client | Instruction file (relative to the project) |
|---|---|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex CLI, Windsurf | `AGENTS.md` |
| Gemini CLI, Google Antigravity | `GEMINI.md` |
| Cursor | `.cursor/rules/hesman.mdc` (its own rule file, `alwaysApply: true`) |
| VS Code (Copilot) | `.github/copilot-instructions.md` |
| Claude Desktop | none: it reads no project file, so it is skipped with a note |

- **Opt-in.** Nothing is written without `--rules`. On a terminal without `--yes`, setup asks once and the default answer is No.
- The block sits between `<!-- hesman:rules:start -->` and `<!-- hesman:rules:end -->`. Running setup again replaces it in place; text outside the markers is never changed, and a file shared by two clients gets the block once.
- `hesman remove` deletes exactly the block and gives the file back byte for byte; a file that Hesman created and that holds nothing else is deleted. Run it in the same project (or pass `--project-root <path>`, which `setup --rules` accepts as well).
- These files are usually committed to git and shared with a team. Setup lists the files it changed so you can review them (`git diff`) and decide whether to commit.

### Launch command

`hesman setup --command auto|npx|global|absolute` decides what the clients run. Setup never uses the network.

| `--command` | Entry written | Needs |
|---|---|---|
| `npx` | `npx -y hesman-mcp@<major>` | the package on npm (not published yet) and `npx` on the client's PATH; survives Node upgrades |
| `global` | `hesman` | a global install (or `npm link`) on the client's PATH |
| `absolute` | `/path/to/node /path/to/hesman-mcp/dist/index.js` | nothing on PATH; run `hesman setup` again after switching Node versions or moving Hesman |

`auto` (the default) looks at how the running Hesman was started:

1. started through `npx` (it runs from an `_npx` cache directory) → `npx`;
2. the `hesman` on PATH is this same installation (symbolic links resolved) → `global`;
3. anything else (source checkout, local `node_modules`, not on PATH) → `absolute`.

Desktop apps (Claude Desktop, Cursor, Antigravity, VS Code, Windsurf) opened from the Dock or a launcher do not get your shell PATH. On macOS and Linux, when `auto` picks `npx` or `hesman` and that command or `node` is not in a standard system directory (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin`, plus `/opt/homebrew/bin` on macOS and `/snap/bin` on Linux) — the usual case with nvm, fnm, volta or asdf — those clients get the `absolute` entry instead, with a note to run `hesman setup` again after switching Node versions. Terminal clients (Claude Code, Codex CLI, Gemini CLI) inherit the shell and keep the chosen command. An explicit `--command npx|global` is written as asked for every client, with a warning where a desktop app may not find it.

### Manual MCP Configuration

Add this to your agent's MCP config file (VS Code uses `"servers"` instead of `"mcpServers"` and needs `"type": "stdio"` in the entry; Codex uses a `[mcp_servers.hesman]` TOML table):

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

`--project-root` is optional; see below. `"command": "hesman"` needs `hesman` on the PATH the client sees; otherwise use `"command": "/path/to/node"` with `"/path/to/hesman-mcp/dist/index.js"` as the first argument (see [Launch command](#launch-command)).

### How Hesman Picks the Project

One server process indexes one project. It is chosen in this order:

1. **Explicit root** — `--project-root <path>`, `HESMAN_PROJECT_ROOT`, or `projectRoot` in `hesman.config.json`. Always wins.
2. **Workspace folders of the MCP client** — when the client supports the MCP `roots` capability, Hesman asks it for its folders after the handshake and indexes the first one (other folders are logged, not indexed). When the client reports a different folder later, Hesman switches to it.
3. **Working directory** — the nearest directory at or above the server's working directory that holds a version-control directory (`.git`, `.hg`, `.svn`, `.jj`) or a project manifest (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …).
4. **No project** — the server still starts and lists its tools, but every tool returns a `NO_PROJECT` error that explains how to set a root.

The home directory and its parent directories are never picked automatically (steps 2 and 3), so a global MCP entry started from `~` does not crawl your disk. The index is stored in `.hesman/` inside the chosen project.

---

## Dashboard

`hesman ui` opens a local web page for one project: what the agents asked Hesman, how fast it answered, how many tokens it saved, what the server logged, and what is in the index.

```bash
cd /path/to/project
hesman ui                 # a free port; opens the browser
hesman ui --no-open       # only print the URL
hesman ui --port 4100     # a fixed port
```

The project must have an index (start the MCP server once, or run `hesman index`). The command prints a URL of the form `http://127.0.0.1:<port>/?token=<random>`; stop it with Ctrl+C.

![Metrics: calls, failures, latency and tokens before and after](./docs/images/dashboard-metrics.png)

| Screen | What it shows |
|---|---|
| **Overview** | Index state, files, symbols and relations, each language with its support tier, and what is unavailable in the dashboard |
| **Metrics** | Tool calls recorded by the MCP server: count, failures, median and 95th-percentile latency, tokens before and after reduction, over time and per tool, with the recent calls |
| **Logs** | The server's log, newest first, filtered by level and text, updated live |
| **Graph** | Find a symbol and see its callers and callees as a graph, or see how files import each other; select a node to load its neighbors |
| **Playground** | Pick a tool, fill in its arguments in a form, run it and see the exact answer an agent gets, with its token numbers |

![Graph: a symbol with its callers and callees](./docs/images/dashboard-graph.png)

Things to know:

- **Metrics and Logs show what the MCP server recorded.** They are empty until an agent has called Hesman in that project; `hesman index` alone records no calls.
- **It runs next to the MCP server.** The dashboard is a separate process that opens the index read-only, so both can run at once.
- **Local only.** It listens on `127.0.0.1`, and every request needs the token from the URL, which changes on each start. Nothing is sent anywhere.
- **Two limits.** `semantic_search` cannot be run from the Playground (the vector store allows one process, and the MCP server holds it), and the dashboard shows the index as stored, not a run in progress.

All options and the HTTP API are in [docs/CLI.md](./docs/CLI.md#hesman-ui); the access rules are in [docs/SECURITY.md](./docs/SECURITY.md).

---

## Uninstalling

Hesman keeps data in four places. Remove them in this order, because the first two steps need the `hesman` command.

**1. Take Hesman out of your AI clients**

```bash
hesman remove --dry-run        # show what would be removed, write nothing
hesman remove                  # remove the hesman entry from every client that has one (user scope)
hesman remove --scope project  # run inside a project that was set up with --scope project
```

`hesman remove` deletes only the `hesman` entry and, if you used `hesman setup --rules`, the block between `<!-- hesman:rules:start -->` and `<!-- hesman:rules:end -->` in the project's instruction files; everything else in those files stays as it was. Restart the clients afterwards. A `<config>.hesman.bak` file next to a client's config is the backup Hesman made before its last edit; delete it when you no longer need it.

**2. Delete the index of each project**

```bash
cd /path/to/project
hesman clean --dry-run   # show the directory and its size
hesman clean --force     # delete .hesman/ (index, vectors, logs, tool-call log)
```

Repeat in every project Hesman was used in, or delete the project's `.hesman/` directory by hand. If you set `HESMAN_DATA_DIR` or `--data-dir`, the data is in that directory instead.

**3. Delete the grammar cache**

Grammars downloaded on demand are kept per user, outside any project. Delete the `hesman` directory in the first location that applies:

| Setting / platform | Directory to delete |
|---|---|
| `HESMAN_CACHE_DIR` is set | `$HESMAN_CACHE_DIR/hesman` |
| `XDG_CACHE_HOME` is set | `$XDG_CACHE_HOME/hesman` |
| macOS | `~/Library/Caches/hesman` |
| Windows | `%LOCALAPPDATA%\hesman` |
| Linux and others | `~/.cache/hesman` |

`hesman grammars list` prints the exact cache directory. If no on-demand grammar was ever downloaded, the directory does not exist.

**4. Remove the program**

```bash
# installed from source
npm unlink -g hesman-mcp   # only if you ran `npm link`
rm -r /path/to/hesman-mcp  # the cloned repository

# installed from npm (once the package is published)
npm uninstall -g hesman-mcp
```

The embedding model is stored inside the package's own `node_modules`, so it disappears with the program. Nothing else is written outside the places above: no background service, no system-wide configuration.

---

## Tools Reference

Hesman exposes **11 tools** over MCP stdio transport. Every tool response except `index_status` includes a `_meta` block with its token savings (`impact_analysis` also returns its own `_summary` of affected files).

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
| `index_status` | Report indexing health: file count, symbol count, store status, pending files, progress of the initial background index |

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
  "dataDir": ".hesman",
  "grammars": { "offline": false }
}
```

> **Symlinks are skipped during indexing.** The project scanner and the file watcher never follow symbolic links (to files or directories). This prevents infinite loops (e.g. `loop -> .`), keeps code outside the project out of the index, and avoids duplicate symbols. To index linked code, point `projectRoot` at the real directory.

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
| `HESMAN_GRAMMARS_OFFLINE` | — | `1` or `true`: never download a grammar (config key `grammars.offline`) |
| `HESMAN_CACHE_DIR` | — | Directory that holds the per-user grammar cache (`<dir>/hesman/grammars/`) |

### CLI Flags

| Flag | Description |
|---|---|
| `--project-root <path>` | Project to index (default: detected, see [How Hesman Picks the Project](#how-hesman-picks-the-project)) |
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
hesman setup                   Add Hesman to your AI clients (--client, --all, --yes, --dry-run, --scope, --project-root, --command, --rules)
hesman remove                  Remove Hesman from the clients again (--client, --all, --scope, --dry-run)
hesman doctor                  Check the installation and each client's entry (--client, --json, --timeout)
hesman ui [path]               Open the local dashboard: logs, metrics, index graph, playground (--port, --no-open)
hesman grammars list           Bundled, cached and on-demand grammars with sizes (--json)
hesman grammars install <lang…> Download grammars into the cache (--all, or --from <directory> without network)
hesman install --agent <name>  Deprecated alias of: hesman setup --client <name> --yes
hesman --version, -v           Print version number
hesman --help, -h              Show help text
```

---

## Supported Languages

<!-- hesman:language-matrix:start (generated by scripts/generate-language-matrix.ts; do not edit by hand) -->
| Language | Extensions | Tier | Grammar | What works |
|---|---|---|---|---|
| TypeScript | `.ts`, `.mts`, `.cts` | deep | bundled | Symbols, call graph, impact analysis |
| TSX | `.tsx` | deep | bundled | Symbols, call graph, impact analysis |
| JavaScript (and JSX) | `.js`, `.jsx`, `.mjs`, `.cjs` | deep | bundled | Symbols, call graph, impact analysis |
| Python | `.py`, `.pyw`, `.pyi` | deep | bundled | Symbols, call graph, impact analysis |
| Go | `.go` | deep | bundled | Symbols, call graph, impact analysis |
| Java | `.java` | deep | bundled | Symbols, call graph, impact analysis |
| C | `.c`, `.h` | deep | bundled | Symbols, call graph, impact analysis |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.ipp`, `.tpp` | deep | bundled | Symbols, call graph, impact analysis |
| C# | `.cs`, `.csx` | deep | bundled | Symbols, call graph, impact analysis |
| Rust | `.rs` | deep | bundled | Symbols, call graph, impact analysis |
| PHP | `.php`, `.phtml` | deep | bundled | Symbols, call graph, impact analysis |
| Ruby | `.rb`, `.rake`, `.gemspec`, `.ru`, `.podspec` | deep | bundled | Symbols, call graph, impact analysis |
| Kotlin | `.kt`, `.kts` | deep | bundled | Symbols, call graph, impact analysis |
| Swift | `.swift` | deep | bundled | Symbols, call graph, impact analysis |
| Bash | `.sh`, `.bash` | deep | bundled | Symbols, call graph, impact analysis |
| Lua | `.lua` | deep | bundled | Symbols, call graph, impact analysis |
| Scala | `.scala`, `.sc`, `.sbt` | structural | on demand | Symbols only (no call graph) |
| OCaml | `.ml` | structural | on demand | Symbols only (no call graph) |
| F# | `.fs`, `.fsx` | structural | on demand | Symbols only (no call graph) |
| R | `.r` | structural | on demand | Symbols only (no call graph) |
| CodeQL | `.ql`, `.qll` | structural | on demand | Symbols only (no call graph) |
| Arduino | `.ino` | structural | on demand | Symbols only (no call graph) |
| Elixir | `.ex`, `.exs` | structural | on demand | Symbols only (no call graph) |
| Everything else | any text file | text | none | Text chunks for `semantic_search`, `find_pattern` and `get_context` (no symbols) |
<!-- hesman:language-matrix:end -->

The table above is generated from the language registry (`npx tsx scripts/generate-language-matrix.ts`; a test fails when it is out of date). The grammars marked *bundled* ship inside the package, so they work offline.

**On-demand grammars.** The grammars marked *on demand* are not in the package. The first time a project contains files of such a language, those files are indexed as text at once and the server downloads the grammar in the background (0.3–11.4 MB per grammar, from the release page of the grammar's own repository on GitHub); when it has arrived the files are re-indexed with symbols. Each grammar is pinned by URL, size and sha256 in the shipped `grammars.json`; a download that does not match is discarded and the files stay text. Grammars are cached per user, outside the project: `HESMAN_CACHE_DIR`, else `XDG_CACHE_HOME`, else `~/Library/Caches` (macOS), `%LOCALAPPDATA%` (Windows) or `~/.cache`, under `hesman/grammars/`.

- **Turn downloads off:** set `HESMAN_GRAMMARS_OFFLINE=1`, or `"grammars": { "offline": true }` in `hesman.config.json`. Hesman then makes no network request for grammars; files of on-demand languages stay on the text tier unless the grammar is already cached.
- **Pre-fill the cache:** `hesman grammars install scala r` or `hesman grammars install --all` (46.9 MB); on a machine without network access, copy the `.wasm` files there and run `hesman grammars install --from <directory>`. `hesman grammars list` shows what is bundled, cached and available. See [docs/CLI.md](./docs/CLI.md#hesman-grammars).
- **See what is missing:** `index_status` lists, per language, its tier (`deep`, `structural` or `text`), the number of files, and whether its grammar is bundled, cached or missing, and why.

`grammars.json` also pins 17 grammars that have no symbols query yet (Haskell, Zig, Julia, Perl, Objective-C, Odin, Luau, Starlark, HTML, CSS, JSON, YAML, TOML, XML, Markdown, HCL, Make). They can be installed with `hesman grammars install`, but Hesman does not use them yet: files of those languages are indexed as text and their grammar is never downloaded automatically.

What the tiers mean today:

- **deep** — definitions (functions, classes, methods, constants, ...) plus `calls` relations, so `get_callers`, `get_callees`, `get_references` and `impact_analysis` have a call graph. Calls are read from the syntax tree of each language (its call expressions, `new X(...)`, Ruby and Bash calls without parentheses), and are linked by name: the caller's own file first, then the files it imports, its directory, and the project; a name that stays ambiguous is left unlinked instead of being linked to every candidate. A call is linked to a definition rather than to a declaration without a body (a C/C++ prototype, an interface or abstract method), and `new X(...)` to the class `X` rather than to one of its constructors. Types are not resolved, so a method called on an interface with several implementations stays unlinked, and a Ruby method called without arguments or parentheses is not seen as a call. Import relations exist for TypeScript/JavaScript, Python, Go, C/C++ (`#include "..."`) and Ruby (`require`, `require_relative`); `extends` / `implements` relations only where a language writes `class X extends Y` or `class X implements Y`.
- **structural** — definitions only. No bundled language is in this tier any more. The on-demand languages are structural because only their upstream symbols query is used: there is no visibility rule for them (every definition counts as exported) and no call extraction.
- **text** — no symbols; see "Text tier" in [docs/TOOLS.md](./docs/TOOLS.md).

An agent does not have to know this table: when `get_callers`, `get_callees`, `get_references` or `impact_analysis` is asked about a symbol of a language without a call graph, the response carries a `note` such as `call graph not available for r (symbols only)` next to the empty list, so an empty answer is not mistaken for "nothing uses this".

Symbol kinds follow each grammar's own tags query, so some are coarser than the language: PHP and Kotlin methods are `function`, Rust and Swift enums and Kotlin interfaces are `class`, Rust type aliases are `class`. Adding a language requires a grammar, a tags query, a small profile and one entry in the language registry (`src/parsers/languages.ts`) — see the [Contributing Guide](./docs/CONTRIBUTING.md) for step-by-step instructions.

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
                         │   │      Token Reduction Pipeline    │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Compact Mode            │  │  │
                         │   │  │    Strip comments/blanks    │  │  │
                         │   │  │ 2. Context Pruning         │  │  │
                         │   │  │    A line range, not a file │  │  │
                         │   │  │ 3. Compact Lists           │  │  │
                         │   │  │    Columns, grouped by file │  │  │
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

**Core data pipeline:** File changes (chokidar) → Tree-sitter parse (AST + symbols) → SQLite index + ZVec embeddings → compact MCP responses

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
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
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

### Performance Thresholds

`npm run test:perf` fails when a benchmark is worse than its threshold (`tests/perf/thresholds.ts`). These are limits checked on the maintainer's macOS machine against the repository's fixtures, not guarantees for every project; `semantic_search` is timed without the embedding of the query.

| Benchmark | Threshold |
|---|---|
| `find_symbol` (exact) | < 1ms |
| `find_symbol` (fuzzy) | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |

### Measured on this repository

`node scripts/measure.mjs` starts the built server over stdio, lets it index a clean export of this repository (502 files: 350 with symbols, 152 as text; 7,700 symbols, 27,372 relations) and calls each tool 100 times through MCP. Measured on 2026-10-13 on an Apple M3 Pro (11 cores, 18 GB), macOS, Node 24. Your numbers depend on the machine and the project; run the script to get them.

| Startup, index and memory | Semantic search on | `--no-semantic` |
|---|---:|---:|
| MCP handshake answered after | 0.4 s | 0.2 s |
| Index ready after | 70.2 s | 2.4 s |
| Index on disk | 46.2 MB | 22.1 MB |
| Memory at the handshake | 286 MB | 195 MB |
| Memory right after indexing | 673 MB | 426 MB |
| Memory at rest (35 s after the last call) | 545 MB | 303 MB |

The server answers tools while it indexes; with semantic search on, almost all of the 70 seconds is spent computing 5,760 embeddings on the CPU. Memory is the process's physical footprint, the number Activity Monitor shows. Parser threads are started only while indexing (at most four by default) and released after 30 seconds of idle time.

| Tool | Call | Median | Plain tokens | Returned tokens | Reduction |
|---|---|---:|---:|---:|---:|
| `get_context` | one function, ±5 lines | 0.39 ms | 4,782 | 190 | 96.0% |
| `get_context` | one function, ±40 lines | 0.46 ms | 4,782 | 970 | 79.7% |
| `get_references` | references to `indexProject` | 0.29 ms | 3,026 | 854 | 71.8% |
| `get_callers` | callers of `indexProject` | 0.24 ms | 1,244 | 373 | 70.0% |
| `get_callees` | callees of `indexProject` | 0.15 ms | 387 | 132 | 65.9% |
| `find_symbol` | prefix `index`, 20 results | 0.38 ms | 2,326 | 1,369 | 41.1% |
| `impact_analysis` | delete `indexProject` | 0.39 ms | 3,498 | 2,116 | 39.5% |
| `get_file_structure` | one source file | 0.34 ms | 3,474 | 2,270 | 34.7% |
| `list_dependencies` | imports of one file | 0.11 ms | 572 | 374 | 34.6% |
| `find_symbol` | exact name, 1 result | 0.14 ms | 214 | 197 | 7.9% |
| `find_pattern` | `console.$M($$$A)` in TypeScript | 38.4 ms | 2,112 | 2,112 | 0.0% |
| `semantic_search` | one natural-language query | 2.75 ms | 3,880 | 3,880 | 0.0% |

"Plain tokens" is the payload as plain JSON objects with absolute paths (for `get_context`, the whole file); tokens are estimated as four characters each. Latency is what the client sees for one call, including MCP framing. `semantic_search` includes embedding the query.

For the full contributing guide including how to add new languages, see **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**.

---

## Requirements

| Resource | Minimum |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Memory** | About 300 MB at rest and 430 MB while indexing without semantic search; about 550 MB at rest and 670 MB while indexing with it (measured on a 502-file project, see [Measured on this repository](#measured-on-this-repository)) |
| **Disk** | ~30 MB for the package (bundled grammars), ~80 MB for the embedding model (one-time download), up to 47 MB for on-demand grammars if all are installed, plus the index in `.hesman/` |
| **Network** | For installation, for the embedding model on first use, and for the grammar of an on-demand language the first time a project contains it. None otherwise; no code or query is ever sent anywhere |

The embedding model (`all-MiniLM-L6-v2`) is downloaded on first use and cached indefinitely in the Transformers.js cache directory.

---

## Documentation

| Document | Content |
|---|---|
| [README.md](./README.md) | Project overview, setup, and configuration (this file) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Full architecture: data flow, module map, store schemas, worker pool design |
| [docs/CLI.md](./docs/CLI.md) | Every subcommand: `setup`, `remove`, `doctor`, `ui`, `grammars`, with options and output |
| [docs/TOOLS.md](./docs/TOOLS.md) | Complete input/output schemas for all 11 tools with examples |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Development setup, test guide, language profile authoring, PR checklist |
| [docs/SECURITY.md](./docs/SECURITY.md) | Threat model, guards on tool input, how to report a vulnerability |
| [CHANGELOG.md](./CHANGELOG.md) | Version history and changes |

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Minh Do

The MIT license covers the code written for Hesman. Third-party software keeps its own license:

- **Inside the package:** the Tree-sitter grammars and query files, all MIT except the Elixir query (Apache-2.0, the license of its grammar); each is listed with its repository, revision and copyright in [NOTICE](./NOTICE).
- **Installed by npm as dependencies:** all under permissive licenses (MIT, ISC, BSD, Apache-2.0); the full list is in [THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md). The embedding library `@xenova/transformers` and the vector store `@zvec/zvec` are Apache-2.0.
- **Downloaded at run time:** the embedding model `Xenova/all-MiniLM-L6-v2` (Apache-2.0) and on-demand grammars (MIT, except Elixir and HCL: Apache-2.0); see [NOTICE](./NOTICE). The `sharp` dependency of the embedding library installs a prebuilt libvips (LGPL-3.0-or-later) as a separate shared library.
