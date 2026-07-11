# Tools Reference

Hesman exposes 11 MCP tools over stdio transport. All responses include a `_meta` block with token reduction statistics.

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

**Output:** Hierarchical symbol tree with `children` arrays for nested symbols, plus `_summary` with `totalSymbols` and `byKind` breakdown.

**Token reduction:** `_summary` block aggregates by kind. Typical compression: 40-60%.

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

**Output:** `references` array with `filePath`, `line`, `col`, `kind`, `callerName`, plus `totalCount`, `hasMore`, `nextCursor` for pagination. Includes `_summary` with `byKind` and `byFile` aggregations.

**Error Codes:**
- `INVALID_INPUT` — missing `symbolId`

**Token reduction:** Pagination cursor prevents full-result dumps; `_summary` replaces individual entries. Typical reduction: 60-80%.

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

**Output:** `callers` array with `symbolId`, `name`, `kind`, `filePath`, `depth`, and `callSite`. Includes `_summary` with `directCount`, `transitiveCount`, `files`, `paths`, and a human-readable `summary` string.

**Error Codes:**
- `INVALID_INPUT` — missing `symbolId`

**Token reduction:** Call chain compression replaces individual entries with depth-grouped paths. Typical reduction: 70-90%.

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

**Output:** `callees` array (same structure as `get_callers`). Includes `_summary` with direct/transitive counts and file groupings.

**Error Codes:**
- `INVALID_INPUT` — missing `symbolId`

**Token reduction:** Same chain compression as `get_callers`.

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

**Token reduction:** Compact mode strips ~50-70% of tokens from full source (comments, blanks, trailing whitespace). Layer 1 (basic): ~50% reduction. Layer 2 (AST-aware): ~60% reduction with JSDoc preservation.

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
    "minScore": { "type": "number", "description": "Minimum score threshold (0-1, default 0.0)" }
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

**Token reduction:** Snippets are compacted before return. Typical reduction: 30-50%.

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

**Output:** `file`, `dependencies` array with `target`, `kind` (`local_file` / `package` / `unresolved`), `importedSymbols`, `count`. Includes `_summary` with `totalCount` and `byKind`.

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
  "health": {
    "sqliteOk": true,
    "zvecOk": true,
    "zvecDocCount": 315,
    "embeddingModelLoaded": true,
    "kuzuOk": false
  },
  "languages": []
}
```

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

Every successful response includes a `_meta` block:

```json
{
  "_meta": {
    "originalTokens": 1240,
    "compressedTokens": 186,
    "reduction": "85.0%",
    "layers": ["compact"]
  }
}
```

Tools with list responses also include `_summary`:

```json
{
  "_summary": {
    "totalCount": 47,
    "byKind": { "calls": 32, "imports": 8, "extends": 7 },
    "byFile": [
      { "filePath": "src/main.ts", "count": 12 },
      { "filePath": "src/utils.ts", "count": 8 }
    ]
  }
}
```

Call chain tools include additional `_summary` fields: `directCount`, `transitiveCount`, `files`, `paths`, and `summary`.
