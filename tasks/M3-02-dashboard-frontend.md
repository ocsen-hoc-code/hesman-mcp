---
id: M3-02
title: Dashboard frontend (overview, metrics, logs, graph explorer, query playground)
status: pending
priority: P0
depends_on: [M0-12]
updated: 2026-10-11
---

## Context

The frontend for `hesman ui`. It is developed in parallel with the backend (M3-01) against the contract below, using a built-in mock mode, and is integrated when both land.

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

1. Static single-page app under `src/ui/public/` (plain ES modules, no CDN, no framework build step; one vendored MIT-licensed graph library is allowed if recorded in `NOTICE`, otherwise a small canvas/SVG renderer). It must work offline.
2. Screens:
   - **Overview:** project, index state and progress, languages with tier, text-tier counts, health, live refresh while indexing.
   - **Metrics:** calls, errors, latency (p50/p95), tokens before/after per tool, a time series, recent calls table.
   - **Logs:** newest first, level filter, text filter, pause/resume auto-refresh, expandable structured fields.
   - **Graph:** search a symbol, show its neighborhood (callers, callees, other relations), expand a node, a file-level overview, a details panel (kind, file:line, signature) with a link into the playground; legible with ~100 nodes; says clearly when a result is truncated.
   - **Query playground:** pick a tool, a form generated from its `inputSchema` (enums, numbers with min/max, required fields), run it, show the JSON result, `isError`, duration and `_meta` token numbers; keep a short local history.
3. `?mock=1` serves realistic mock data for every endpoint so the UI can be developed and tested without a backend.
4. Quality bar: keyboard accessible, visible focus, sufficient contrast, light and dark themes, usable at 1280 px and at phone width, clear empty/loading/error states (including 401 and "backend unavailable"). User-visible strings in English.
5. Tests: unit tests for the pure logic (schema → form, formatting, graph model merge); a smoke test that loads the page in mock mode; screenshots or a written check of each screen in a real browser.

## Out of scope

- Backend endpoints (M3-01). Editing files, changing configuration, or anything that writes besides running a tool.

## Acceptance criteria

- [ ] All five screens work in mock mode and against the real backend after integration.
- [ ] No network request leaves 127.0.0.1 (checked in the browser's network panel or by test).
- [ ] The playground can run every tool the server lists.
- [ ] `npm test` green; no new runtime dependency.

## Verification

```bash
npm test
node dist/index.js ui    # then use each screen
```

## Progress notes

- 2026-10-11: task created and started (branch `rebuild/m1-m2`).
