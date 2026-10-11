---
id: M3-01
title: Observability data + `hesman ui` backend (HTTP API)
status: pending
priority: P0
depends_on: [M0-12]
updated: 2026-10-11
---

## Context

The owner wants a web frontend to view logs and metrics, explore the indexed information as a graph, and try queries. Today logs go only to the MCP client's stderr, `MetricsCollector` (`src/diagnostics/metrics.ts`) writes periodic snapshots, per-tool-call data is not recorded, and there is no HTTP surface. The `logFile` config field exists but is unused.

## API contract (shared by M3-01 and M3-02 — do not change one side without the other)

Server: `hesman ui [path] [--port <n>] [--no-open]` → `http://127.0.0.1:<port>/?token=<random>`. Binds 127.0.0.1 only. Every `/api/*` request needs the token (`Authorization: Bearer <token>`, or the `hesman_ui` cookie set when the page is first loaded with `?token=`); otherwise 401. Requests whose `Host` is not `127.0.0.1:<port>`/`localhost:<port>`, or whose `Origin` is present and different, get 403. All responses are JSON `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. The UI is read-only except `POST /api/tools/:name`, which runs the same tool handlers as MCP (same validation, same path confinement).

| Method + path | Returns (`data`) |
|---|---|
| `GET /api/status` | `{ version, projectRoot, dataDir, serverTime, index: <index_status payload incl. indexing, languages, textTier, health> }` |
| `GET /api/metrics?windowMinutes=60` | `{ summary: { calls, errors, p50Ms, p95Ms, tokensOriginal, tokensReturned }, byTool: [{ tool, calls, errors, avgMs, p95Ms, tokensOriginal, tokensReturned }], series: [{ t, calls, errors, avgMs }] }` |
| `GET /api/calls?limit=50&before=<id>&tool=` | `{ calls: [{ id, time, tool, durationMs, ok, errorCode, originalTokens, compressedTokens, argsPreview }], nextBefore }` |
| `GET /api/logs?level=info&q=&limit=200&before=<cursor>` | `{ entries: [{ time, level, name, msg, fields }], nextBefore }` (newest first) |
| `GET /api/graph/search?q=&kind=&language=&limit=30` | `{ symbols: [{ id, name, kind, filePath, startLine, endLine, language, isExported }] }` |
| `GET /api/graph/neighborhood?symbolId=&depth=1&limit=80` | `{ center, nodes: [{ id, name, kind, filePath, startLine, language }], edges: [{ from, to, kind, line }], truncated }` (callers + callees + other relations) |
| `GET /api/graph/files?limit=200` | `{ nodes: [{ id: filePath, language, symbols }], edges: [{ from, to, count }], truncated }` (file-level import/call graph) |
| `GET /api/tools` | `{ tools: [{ name, description, inputSchema }] }` |
| `POST /api/tools/:name` body `{ args }` | `{ result: <tool JSON incl. _meta>, isError, durationMs }` |

File paths in responses are project-relative with `/`. Line numbers are 1-based.

## Scope

1. **Log file:** the MCP server also writes structured logs to `<dataDir>/logs/hesman.log` (JSON lines; size-capped with one rotated file; honors `logFile` when set; never to stdout). Secrets and file contents must not be logged.
2. **Tool-call log:** every tool call is recorded (time, tool, duration, ok / error code, `_meta` token counts, a short args preview with long strings truncated) in `<dataDir>` so another process can read it (SQLite table or JSONL — decide and justify; bounded size). Recording must not slow a call measurably or fail it.
3. **`hesman ui`:** a `node:http` server implementing the contract above with no new runtime dependency; opens the project's stores read-only where possible and must work while an MCP server for the same project is running (state clearly what is unavailable in that case, e.g. `semantic_search` if the vector store cannot be shared); serves the static frontend from `dist/ui/` (a build step copies `src/ui/public/` there; a placeholder `index.html` is enough until M3-02 lands).
4. **Security:** 127.0.0.1 only, random token, Host/Origin checks, no directory listing, static files confined to the UI directory, tool input validated exactly as over MCP. Add the dashboard to `docs/SECURITY.md`.
5. Tests: unit tests for every endpoint with a temp project (no real home, no network), auth/Host/Origin rejection, static path traversal, log rotation, tool-call recording; one e2e that starts `hesman ui`, fetches `/api/status` and runs one tool.

## Out of scope

- The frontend itself (M3-02). Multi-project switching and remote access.

## Acceptance criteria

- [ ] Every endpoint of the contract is implemented and tested.
- [ ] Unauthenticated, wrong-Host and cross-Origin requests are rejected (tests).
- [ ] Logs and tool calls written by a running MCP server are visible through the API from a separate `hesman ui` process (e2e).
- [ ] No new runtime dependency; `npm test` green.

## Verification

```bash
npm test
node dist/index.js ui --no-open   # prints the URL
```

## Progress notes

- 2026-10-11: task created and started (branch `rebuild/m1-m2`).
