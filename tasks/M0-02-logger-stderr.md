---
id: M0-02
title: Log to stderr through one shared logger
status: done
priority: P0
depends_on: [M0-01]
updated: 2026-10-06
---

## Context

- `src/utils/logger.ts` creates `pino` with no destination, which defaults to **stdout**; the `pino-pretty` transport also defaults to `destination: 1`.
- In MCP stdio mode, stdout is the JSON-RPC channel. Reproduced on 2026-10-06: running `node dist/index.js`, stdout contained ANSI-colored lines such as `INFO (zvec): ZVec collection created` before any JSON-RPC message.
- Every `createLogger(name)` call builds a new pino instance and **a new transport**; with pino-pretty each transport runs its own worker thread — a dozen-plus threads just for logging.
- Pretty printing is toggled by `NODE_ENV`, but under an MCP client stderr is not a TTY, so color output is wasted.

## Scope

1. **Failing test first** (M0-01 harness, *without* setting `HESMAN_LOG_LEVEL`): every stdout line must `JSON.parse` and contain `"jsonrpc": "2.0"`.
2. `logger.ts`:
   - Build **one** shared root logger; `createLogger(name)` returns `root.child({ name })`.
   - Write to stderr: `pino.destination(2)` when not pretty; `destination: 2` for pino-pretty.
   - Use pino-pretty only when `process.stderr.isTTY`.
   - Keep honoring `HESMAN_LOG_LEVEL`.
3. Confirm there is no `console.log` on the server code path (currently only in `src/cli/`, which is fine — those are CLI commands, not MCP mode).

## Out of scope

- Implementing the `logFile` config field (backlog: dead-config cleanup).

## Acceptance criteria

- [x] The clean-stdout test passes at the default `info` level.
- [x] Logs still appear on stderr.
- [x] At most one transport thread is used for logging.
- [x] `tests/unit/utils/logger.test.ts` is updated and passes.

## Verification

```bash
npm test && npm run test:e2e
# Manual: nothing should reach stdout before a client sends a request
node dist/index.js --no-watch --no-semantic < /dev/null 2>/dev/null | head -c 200
```

## Progress notes

- 2026-10-06: done. `logger.ts` now builds one lazily-created root logger; `createLogger(name)` returns `root.child({ name }, { level })` (level from `HESMAN_LOG_LEVEL`, default `info`). Output goes to fd 2 via `pino.destination(2)`; pino-pretty (with `destination: 2`) is used only when `process.stderr.isTTY`, so at most one transport thread exists. Added `tests/e2e/stdout-clean.test.ts` (failed before: ~15 pino lines on stdout, 0 on stderr) and expanded `tests/unit/utils/logger.test.ts`. No `console.log` outside `src/cli/`. Manual check on a fixture copy: 0 bytes on stdout, 14 JSON log lines on stderr. Observed (out of scope): the server does not exit on stdin EOF, so the spec's `< /dev/null | head -c 200` command hangs; run it with a timeout/kill instead.
- 2026-10-06: task created.
