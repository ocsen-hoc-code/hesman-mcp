---
id: M0-01
title: Real-server e2e harness + polyglot fixture
status: done
priority: P0
depends_on: []
updated: 2026-10-06
---

## Context

The current e2e tests hide both verified core bugs:
- `tests/e2e/tools.test.ts:37-40` runs `npx tsx src/index.ts` with `HESMAN_LOG_LEVEL: 'error'`, so stdout log pollution never shows up.
- Only the `ts-basic` fixture is used, so Python/Go indexing 0 files goes unnoticed.
- The SDK's `StdioClientTransport` is used, so raw stdout is never inspected.
- Startup is awaited with a fixed `setTimeout(3000)` — slow and flaky.

Every other M0 task needs this harness to write its failing test first.

## Scope

1. **New fixture** `tests/fixtures/polyglot-basic/` with a few small TS, Python and Go files. Each language has at least one function calling another; symbol names are unique across languages (e.g. `tsGreet`, `py_greet`, `GoGreet`).
2. **Helper** `tests/e2e/helpers/server.ts`:
   - Runs the shipped binary: `node dist/index.js` (not `tsx`).
   - Records **every raw stdout line** before parsing (hint: implement an MCP SDK `Transport` wrapping `child_process` stdio).
   - Exposes a normal MCP `Client` for tool calls.
   - Uses a temp data dir (`fs.mkdtemp`), removed on `stop()`.
   - Defaults to `--no-semantic` to avoid downloading the embedding model; opt-in flag to enable it.
   - Waits for readiness by polling `index_status` until `totalFiles > 0` or a timeout — no fixed sleep.
3. `package.json`: add `"pretest:e2e": "npm run build"` so e2e always runs against a fresh `dist/`.
4. Baseline tests that must **pass** now: `listTools` returns all 11 tools; `find_symbol` finds a TypeScript symbol in the polyglot fixture.

## Out of scope

- Fixing stdout or Python/Go — their failing tests belong to M0-02 and M0-03.
- Rewriting existing e2e tests (keep them; migrate to the helper in M0-12 if useful).

## Acceptance criteria

- [x] `npm run test:e2e` builds first and runs against `dist/index.js`.
- [x] The helper exposes the raw stdout lines to tests.
- [x] `polyglot-basic` contains TS, Python and Go sources.
- [x] No fixed `setTimeout` in the helper; readiness wait has an explicit timeout.
- [x] The temp data dir is removed after tests; nothing is left in `tests/fixtures/`.
- [x] Works on macOS, Linux and Windows (use `path`, never string-join `/`).

## Verification

```bash
npm run test:e2e
git status   # no stray files under tests/fixtures/
```

## Progress notes

- 2026-10-06: done. Added `tests/e2e/helpers/server.ts` (custom `RecordingStdioTransport` over `node dist/index.js`, records raw stdout/stderr, filters non-JSON-RPC lines before the MCP `Client`; temp data dir via `mkdtemp`, removed in `stop()`; readiness polls `index_status` with an explicit deadline), fixture `tests/fixtures/polyglot-basic/` (ts/, py/, go/), `tests/e2e/harness.test.ts`, and the `pretest:e2e` script. Deviation: with `--no-semantic` the server registers only 10 tools (`semantic_search` needs the vector store), so the baseline asserts 10 tools in the default mode and all 11 in a second block started with `semantic: true`. The only `setTimeout` uses are the poll interval inside the deadline-bounded readiness loop and the SIGKILL fallback in `close()`; there is no fixed startup sleep. Probe: today the server writes ~15 pino lines to stdout, all captured in `nonProtocolStdoutLines` (input for M0-02). Verified: typecheck clean, lint 0 errors / 36 warnings, `npm test` 37 files / 226 tests, `npm run test:e2e` 4 files / 27 tests (`cli.test.ts` "clean --dry-run" failed once under load and passed on rerun; that flakiness is pre-existing).
- 2026-10-06: task created.
