---
id: M0-01
title: Real-server e2e harness + polyglot fixture
status: todo
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

- [ ] `npm run test:e2e` builds first and runs against `dist/index.js`.
- [ ] The helper exposes the raw stdout lines to tests.
- [ ] `polyglot-basic` contains TS, Python and Go sources.
- [ ] No fixed `setTimeout` in the helper; readiness wait has an explicit timeout.
- [ ] The temp data dir is removed after tests; nothing is left in `tests/fixtures/`.
- [ ] Works on macOS, Linux and Windows (use `path`, never string-join `/`).

## Verification

```bash
npm run test:e2e
git status   # no stray files under tests/fixtures/
```

## Progress notes

- 2026-10-06: task created.
