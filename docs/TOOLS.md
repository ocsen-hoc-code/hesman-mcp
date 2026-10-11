# Tools Reference

Hesman exposes 11 MCP tools over stdio transport. Every tool response except `index_status` includes a `_meta` block with token reduction statistics.

**Startup:** the server answers `initialize` and `tools/list` immediately; the embedding model and the initial index are loaded in the background. Every tool works during that time and answers from what is indexed so far. While the index is still being built, `_meta.indexing` marks results as possibly incomplete (see [Response Structure](#response-structure)) and [`index_status`](#index_status) reports the progress.

**Project:** one server process indexes one project, chosen in this order: (1) an explicit root (`--project-root`, `HESMAN_PROJECT_ROOT`, or `projectRoot` in `hesman.config.json`); (2) the first folder the MCP client reports through `roots/list`, when the client declares the `roots` capability — Hesman asks after the handshake, waits at most 5 seconds for the answer, and switches project when the client sends `notifications/roots/list_changed` with a different first folder; (3) the nearest directory at or above the server's working directory that holds a version-control directory or a project manifest; (4) none. The home directory and its parents are never chosen in steps 2 and 3. Tool calls that arrive while the project is being determined or switched wait for the outcome. With no project, every tool (including `index_status`) returns the `NO_PROJECT` error, whose message says how to set a root; `tools/list` still works. Relative `filePath` arguments resolve against the chosen project, and its index lives in `<project>/.hesman/`.

**Line numbers:** every line number Hesman accepts or returns (`startLine`, `endLine`, `line`, parse-error lines) is **1-based and inclusive**. The first line of a file is line 1. A symbol's `startLine` can be passed straight to `get_context`, and it matches the `line` that `find_pattern` reports for the same declaration. Indexes built before this convention (0-based) are detected by their schema version and rebuilt automatically on the next start.

---

## `find_symbol`

Look up symbols by name with configurable matching.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Symbol name to search for" },
    "kind": {
      "type": "string",
      "enum": ["function", "class", "method", "variable", "interface", "type", "enum", "namespace"],
      "description": "Filter by symbol kind"
    },
    "filePath": { "type": "string", "description": "Limit search to this file path" },
    "matchMode": {
      "type": "string",
      "enum": ["exact", "fuzzy", "prefix"],
      "description": "Match mode (default: fuzzy)"
    },
    "topK": { "type": "number", "description": "Max results (default 20)" }
  },
  "required": ["name"]
}
```

**Example:**
```
find_symbol({ name: "Calculator", matchMode: "exact" })
```

**Output:** Array of matching symbols with `id`, `name`, `kind`, `filePath`, `startLine`, `endLine`, `signature`, `docComment`, `isExported`, `language`.

**Token reduction:** `_meta` with original/compressed token counts. FTS5 fuzzy search returns results under 5ms.

---

## `get_file_structure`

Get the symbol structure of a file — functions, classes, methods, etc.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "filePath": { "type": "string", "description": "Path to the file to analyze" },
    "includeNested": { "type": "boolean", "description": "Include nested symbols (methods in classes). Default: true" }
  },
  "required": ["filePath"]
}
```

**Example:**
```
get_file_structure({ filePath: "src/index.ts" })
```

**Output:** Hierarchical symbol tree with `children` arrays for nested symbols.

**Token reduction:** none yet — summaries are not applied, so the plain payload is returned with `_meta.reduction: "0.0%"` (measured). See [Response Structure](#response-structure) and the backlog item in [`tasks/STATUS.md`](../tasks/STATUS.md).

---

## `get_references`

Find all usages of a symbol across the codebase.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "symbolId": { "type": "string", "description": "Symbol ID to find references for" },
    "referenceKind": {
      "type": "string",
      "description": "Filter: calls, import, extends, implements, type_ref, all"
    },
    "topK": { "type": "number", "description": "Max results (default 50, max 200)" },
    "cursor": { "type": "string", "description": "Pagination cursor from previous response" }
  },
  "required": ["symbolId"]
}
```

**Example:**
```
get_references({ symbolId: "a1b2c3d4e5f6g7h8", referenceKind: "calls", topK: 10 })
```

**Output:** `references` array with `filePath`, `line`, `col`, `kind`, `callerName`, plus `totalCount`, `hasMore`, `nextCursor` for pagination.

**Error Codes:**
- `INVALID_INPUT` — missing `symbolId`

**Token reduction:** `topK` and the pagination cursor bound each page. Summaries are not applied yet, so `_meta.reduction` is `0.0%` (measured). See [Response Structure](#response-structure) and the backlog item in [`tasks/STATUS.md`](../tasks/STATUS.md).

---

## `get_callers`

Traverse the call graph upward — find who calls a symbol.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "symbolId": { "type": "string", "description": "Symbol ID to find callers for" },
    "maxDepth": { "type": "number", "description": "Max call chain depth (default 1, max 3)" },
    "topK": { "type": "number", "description": "Max results (default 50)" }
  },
  "required": ["symbolId"]
}
```

**Example:**
```
get_callers({ symbolId: "a1b2c3d4e5f6g7h8", maxDepth: 2 })
```

**Output:** `callers` array with `symbolId`, `name`, `kind`, `filePath`, `depth`, and `callSite`.

**Error Codes:**
- `INVALID_INPUT` — missing `symbolId`

**Token reduction:** none yet — call chain summaries are not applied, so the plain payload is returned with `_meta.reduction: "0.0%"` (measured). See [Response Structure](#response-structure) and the backlog item in [`tasks/STATUS.md`](../tasks/STATUS.md).

---

## `get_callees`

Traverse the call graph downward — find what a symbol calls.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "symbolId": { "type": "string", "description": "Symbol ID to find callees for" },
    "maxDepth": { "type": "number", "description": "Max call chain depth (default 1, max 3)" },
    "topK": { "type": "number", "description": "Max results (default 50)" }
  },
  "required": ["symbolId"]
}
```

**Example:**
```
get_callees({ symbolId: "a1b2c3d4e5f6g7h8", maxDepth: 2, topK: 100 })
```

**Output:** `callees` array (same structure as `get_callers`).

**Error Codes:**
- `INVALID_INPUT` — missing `symbolId`

**Token reduction:** none yet (same as `get_callers`).

---

## `get_context`

Retrieve focused code context around a location with compact mode and symbol detection.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "filePath": { "type": "string", "description": "Absolute or relative file path" },
    "startLine": { "type": "number", "description": "Focus line number (1-indexed)" },
    "endLine": { "type": "number", "description": "End line (default: same as startLine)" },
    "contextLines": { "type": "number", "description": "Lines of context above and below (default: 5)" },
    "mode": { "type": "string", "enum": ["compact", "full"], "description": "Compact mode strips comments and blank lines (default: compact)" },
    "symbolName": { "type": "string", "description": "Optional — return symbols in range" }
  },
  "required": ["filePath", "startLine"]
}
```

**Example:**
```
get_context({ filePath: "src/index.ts", startLine: 42, contextLines: 3, mode: "compact" })
```

**Output:** `filePath`, `startLine`, `endLine`, `content` (compacted code), `language`, `totalLines`, `symbolsInRange` (symbols overlapping the context window).

**Error Codes:**
- `FILE_NOT_FOUND` — file does not exist

**Token reduction:** context pruning returns only the requested lines plus `contextLines` around them, and `_meta.reduction` is measured against the whole file: 89.9% with the default ±5 lines and 29.9% with ±40 lines on a 195-line file, 0% when the whole file is requested. Compact mode (level 1: comments, blank lines, trailing whitespace) saved ~14–16% of the response in the same measurements.

---

## `semantic_search`

Search code by natural language description using AI embeddings (all-MiniLM-L6-v2).

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Natural language query to search for" },
    "topK": { "type": "number", "description": "Max results (default 10, max 50)" },
    "filePattern": { "type": "string", "description": "Glob filter, e.g. \"src/**/*.ts\"" },
    "language": { "type": "string", "description": "Filter by language: typescript, python, ..." },
    "kind": { "type": "string", "description": "Filter by symbol kind: function, class, method, ..." },
    "minScore": { "type": "number", "description": "Minimum score threshold (0-1, default 0.0). Relevant matches typically score 0.3-0.6; thresholds above 0.5 often return nothing." }
  },
  "required": ["query"]
}
```

**Example:**
```
semantic_search({ query: "function that validates email addresses", language: "typescript", topK: 5 })
```

**Output:** `results` array with `symbolId`, `name`, `kind`, `filePath`, `snippet` (compacted), `score`, `matchType` (`semantic` / `keyword` / `both`), plus `totalFound`, `tookMs`, `embeddingTookMs`.

**Error Codes:**
- `INVALID_INPUT` — empty query or disabled in config
- `INDEX_NOT_READY` — embedding model not loaded

**Token reduction:** snippets are compacted (comments and blank lines removed) before the response is built, so that saving is not included in `_meta.reduction`.

**Notes:**
- First run downloads the ~80MB embedding model (cached indefinitely)
- Embedding is sequential within each request (batching deferred)

---

## `list_dependencies`

List dependencies for a file or across the project.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "filePath": { "type": "string", "description": "File path to analyze (optional; returns all project-level imports if omitted)" },
    "direction": {
      "type": "string",
      "enum": ["imports", "imported_by", "both"],
      "description": "Direction: imports (default, what the file imports), imported_by (what imports from the file), or both"
    }
  }
}
```

**Example:**
```
list_dependencies({ filePath: "src/server.ts", direction: "both" })
```

**Output:** `file`, `dependencies` array with `target`, `kind` (`local_file` / `package` / `unresolved`), `importedSymbols`, `count`.

**Token reduction:** none yet — summaries are not applied, so `_meta.reduction` is `0.0%` (measured). See [Response Structure](#response-structure) and the backlog item in [`tasks/STATUS.md`](../tasks/STATUS.md).

**Error Codes:**
- `INVALID_INPUT` — invalid direction value

---

## `impact_analysis`

Analyze what breaks if a symbol changes — categorized by severity.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "symbolId": { "type": "string", "description": "Symbol ID to analyze" },
    "changeType": {
      "type": "string",
      "enum": ["rename", "change_signature", "delete", "change_return_type"]
    },
    "newName": { "type": "string", "description": "New name (if rename)" },
    "newSignature": { "type": "string", "description": "New signature (if change_signature)" },
    "newReturnType": { "type": "string", "description": "New return type (if change_return_type)" },
    "maxFiles": { "type": "number", "description": "Max impacted files in output (default 20)" }
  },
  "required": ["symbolId", "changeType"]
}
```

**Example:**
```
impact_analysis({
  symbolId: "a1b2c3d4e5f6g7h8",
  changeType: "rename",
  newName: "CalculatorV2"
})
```

**Output:**
- `symbol` — the target symbol's info
- `changeType` — the type of change
- `_summary` — `totalFiles`, `mustFix`, `shouldReview`, `info`, `estimatedChanges`
- `impactedFiles` — array of files with `filePath`, `severity`, `locations` (each with `line`, `col`, `kind`, `action`, `currentCode`), and `reason` string

**Severity levels:**
| Severity | Criteria | Description |
|----------|----------|-------------|
| `must_fix` | calls, extends, implements | Will break compilation |
| `should_review` | references | May need updating |
| `info` | imports | FYI only |

**Error Codes:**
- `SYMBOL_NOT_FOUND` — symbol ID not in index

---

## `find_pattern`

Search code by structural pattern with named captures.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Structural pattern like console.$METHOD($$$ARGS). Use $NAME for word capture, $$$ARGS for greedy capture."
    },
    "language": { "type": "string", "description": "Language to search in (e.g. \"typescript\")" },
    "filePattern": { "type": "string", "description": "Glob filter to restrict which files to search" },
    "topK": { "type": "number", "description": "Max results (default 20, max 100)" }
  },
  "required": ["pattern", "language"]
}
```

**Pattern Syntax:**
| Placeholder | Meaning | Captures |
|-------------|---------|----------|
| `$NAME` | Word token (`\w+`) | Named capture group |
| `$$$ARGS` | Any characters (`.+`) | Named capture group (greedy) |

**Example:**
```
find_pattern({ pattern: "console.$METHOD($$$ARGS)", language: "typescript" })
```
This finds all `console.log(...)`, `console.error(...)`, etc. calls.

**Output:** `matches` array with `filePath`, `line`, `snippet` (context: 2 lines above/below), `bindings` (captured `$NAME` / `$$$ARGS` values).

**Error Codes:**
- `INVALID_INPUT` — missing pattern, language, or invalid pattern syntax

---

## `index_status`

Check the indexing status of the project.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output:**
```json
{
  "totalFiles": 42,
  "indexedFiles": 42,
  "totalSymbols": 315,
  "totalRelations": 892,
  "lastFullIndexTime": "2026-07-11T10:30:00.000Z",
  "lastIncrementalIndexTime": null,
  "pendingFiles": 0,
  "indexing": {
    "inProgress": false,
    "phase": "ready",
    "filesDone": 42,
    "filesTotal": 42,
    "startedAt": "2026-07-11T10:29:58.000Z",
    "error": null
  },
  "health": {
    "sqliteOk": true,
    "zvecOk": true,
    "zvecDocCount": 315,
    "embeddingModelLoaded": true,
    "embeddingModelError": null
  },
  "languages": [
    { "language": "typescript", "files": 30, "symbols": 240 },
    { "language": "go", "files": 12, "symbols": 75 }
  ]
}
```

`languages` lists every indexed language with the number of files and symbols stored for it in SQLite, most files first. `totalFiles` and the per-language `files` count files that produced at least one symbol. `index_status` is not compressed and carries no `_meta` block.

`indexing` describes the initial index, which runs in the background after the MCP handshake:

- `inProgress` — `true` from server start until the initial index has finished (or failed). Poll until it is `false` to wait for a complete index.
- `phase` — `loading-model` (waiting for the embedding model; only with semantic search enabled), `scanning` (listing files), `indexing` (hashing, parsing and storing files), `resolving` (linking call relations), then `ready` or `failed`. `idle` means no run was started. (`resolving-root` — the project is not known yet — is an internal phase: tool calls wait until it is over.)
- `filesDone` / `filesTotal` — files handled so far (stored, skipped as unchanged, or failed) out of the files found by the scan. `filesTotal` is `0` until the scan is done. `pendingFiles` is `filesTotal - filesDone` while indexing runs and `0` otherwise.
- `startedAt` — when the run began (ISO 8601), `null` if none was started.
- `error` — the message of the error that ended the run when `phase` is `failed`, otherwise `null`. The server keeps running and answers from whatever was indexed.

`health.embeddingModelError` holds the reason the embedding model failed to load (`null` otherwise). Until the model is loaded, `semantic_search` returns `INDEX_NOT_READY` — "still loading" during `loading-model`, or the load failure — and every other tool keeps working.

While the index is being built, `totalFiles`, `totalSymbols`, `totalRelations` and `languages` count what is stored so far.

---

## Error Codes

| Code | Meaning |
|------|---------|
| `FILE_NOT_FOUND` | The specified file does not exist |
| `SYMBOL_NOT_FOUND` | The specified symbol ID was not found in the index |
| `INDEX_NOT_READY` | Index or embedding model not yet loaded |
| `INVALID_INPUT` | Missing or invalid input parameters |
| `PARSE_FAILED` | Failed to parse source file with tree-sitter |
| `INTERNAL_ERROR` | Unexpected internal error |
| `STORE_LOCKED` | SQLite store is locked by another process |
| `WORKER_CRASHED` | A worker thread crashed during processing |
| `EMBEDDING_FAILED` | Embedding generation failed |
| `PARTIAL_RESULTS` | Results are partial (some data unavailable) |
| `RATE_LIMITED` | Too many requests |
| `CONFIG_INVALID` | Configuration validation failed |
| `NO_PROJECT` | No project is selected (no explicit root, no usable client root, working directory is not inside a project); the message explains how to set one |

All error responses follow the format:
```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "symbolId is required"
  }
}
```

---

## Response Structure

Every successful response (except `index_status`) includes a `_meta` block:

```json
{
  "_meta": {
    "originalTokens": 1764,
    "compressedTokens": 178,
    "reduction": "89.9%",
    "compressed": false,
    "layers": ["prune"]
  }
}
```

- `originalTokens` — the baseline: the plain (uncompressed) payload, or the pre-pruning size (e.g. the whole file for `get_context`) when that is larger.
- `compressedTokens` — the size of the payload actually returned (excluding `_meta`).
- `reduction` — `1 - compressedTokens / originalTokens`, never negative.
- `compressed` — `true` when the response compressor's own compaction made the payload smaller and was kept; `false` otherwise, in which case the plain payload is returned unchanged (and `reduction` is `0.0%` unless pruning saved tokens). `get_context` in compact mode reports `false` because its excerpt is already compacted by the tool.
- `layers` — the layers that actually contributed: `compact`, `prune` (`summary` is reserved; it never appears today).
- `indexing` — present **only while the initial index is running**: `{ "inProgress": true, "filesDone": 1200, "filesTotal": 6000 }`. The response was answered from a partial index, so results may be incomplete (missing symbols, callers or references); retry later or poll `index_status` until `indexing.inProgress` is `false`. The field is omitted once the index is complete, so normal responses do not grow.

Hesman never returns a response larger than its uncompressed form. The response compressor builds a `_summary` (counts by kind and file) for list and call-graph tools, but it only adds to the full list, so it never makes a response smaller and is always dropped: `get_references`, `get_callers`, `get_callees`, `list_dependencies` and `get_file_structure` return their plain payload with `reduction: "0.0%"` and `compressed: false`. Replacing long lists with a summary plus the top entries is a backlog item in [`tasks/STATUS.md`](../tasks/STATUS.md). `impact_analysis` builds its own `_summary` (`totalFiles`, `mustFix`, `shouldReview`, `info`, `estimatedChanges`) as part of its payload.
