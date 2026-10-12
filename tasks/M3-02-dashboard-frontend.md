---
id: M3-02
title: Dashboard frontend (overview, metrics, logs, graph explorer, query playground)
status: pending
priority: P0
depends_on: [M0-12]
updated: 2026-10-12
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

- [x] All five screens work in mock mode and against the real backend after integration. *(Checked in a browser on 2026-10-12 against `node dist/index.js ui` after merging M3-01 into the task branch; the integrator should repeat it on the integration branch.)*
- [x] No network request leaves 127.0.0.1 (checked in the browser's network panel or by test).
- [x] The playground can run every tool the server lists. *(The 10 tools the real `hesman ui` lists and the 11 of mock mode.)*
- [x] `npm test` green; no new runtime dependency.

## Verification

```bash
npm test
node dist/index.js ui    # then use each screen
```

## Progress notes

- 2026-10-12: merged the finished M3-01 backend into the task branch (kept this task's `index.html` over the placeholder) and checked the dashboard in Chrome against the real `node dist/index.js ui` on an indexed copy of `src/`: overview, the file graph (118 files, 632 links), a symbol neighborhood with expansion and signatures, every listed tool in the playground, and metrics and logs filled by a real MCP server run. No console error under the server's Content-Security-Policy; every request went to 127.0.0.1. Status stays `pending` until the integrator merges this branch.
- 2026-10-12: handled the additions the finished M3-01 backend made to the contract: `limitations` in `/api/status` (shown on the overview and in the playground), `TOOL_UNAVAILABLE` (409) and `PAYLOAD_TOO_LARGE` (413) messages, numeric or string `nextBefore` cursors, `null` token counts, `truncated` on graph search, and the `default-src 'self'` policy (no inline script or style; checked in Chrome against a scratch server sending that header). Mock scenario `limited` reproduces the dashboard next to a running MCP server.
- 2026-10-12: frontend built under `src/ui/public/` with unit tests in `tests/unit/ui/`; status stays `pending`, awaiting integration with the M3-01 backend. Checked in Chrome through the DevTools protocol: all five screens in mock mode at 1280 px and at 390 px, light and dark, the `indexing`, `empty`, `unauthorized`, `forbidden` and `offline` scenarios, and the real `fetch` path (Bearer token, JSON over HTTP, `POST /api/tools/:name`) against a scratch server that answers the contract from the mock data. No console errors apart from the browser's own line for an expected 401; every request went to 127.0.0.1. No graph library was vendored: the graph is an SVG renderer with a small force layout. Open points for integration are listed in the hand-over report (language tier and signature are not in the contract; meaning of `level` in `/api/logs`).
- 2026-10-12: started (branch `rebuild/m1-m2`), in parallel with M1-08 at the owner's request.
- 2026-10-11: task created. Not started: the owner asked to fix the extraction bugs (M1-08) first.
