---
id: M0-09
title: Validate and clamp numeric tool arguments
status: done
priority: P2
depends_on: []
updated: 2026-10-06
---

## Context

Numeric arguments are cast with `as number` and never bounded:
- `src/server/tools/find-symbol.ts:31` `topK = args.topK || 20` — no lower or upper bound.
- `src/server/tools/get-callers.ts:20`, `get-callees.ts:20` — `topK` unbounded (`maxDepth` is already capped at 3).
- `src/server/tools/get-context.ts:25-27` — `startLine`, `endLine`, `contextLines` unbounded.
- SQLite treats `LIMIT -1` as **no limit**, so `topK: -1` dumps the whole index in one response.
- Non-numbers (strings, `NaN`, floats) slip through with unpredictable behavior.

## Scope

1. Create `src/server/args.ts` with a function like `intArg(args, name, { default, min, max })`:
   - Missing → `default`; not a finite integer → `INVALID_INPUT`; out of range → clamp to `[min, max]`.
2. Apply it to **every** numeric argument across the 11 tools (`topK`, `maxDepth`, `startLine`, `endLine`, `contextLines`; a float variant for `minScore`).
3. Add `minimum` / `maximum` to each `inputSchema` so agents see the limits.

## Out of scope

- Full Zod validation of all inputs (backlog).

## Acceptance criteria

- [x] Unit tests for the helper: missing, negative, 0, too large, float, string, `NaN`.
- [x] Test: `find_symbol` with `topK: -1` returns no more than the maximum.
- [x] `grep -rn "as number" src/server/tools` returns nothing.

## Verification

```bash
npm test
grep -rn "as number" src/server/tools
```

## Progress notes

- 2026-10-06: done. Added `src/server/args.ts` (`intArg`, `numberArg`, `InvalidArgumentError`, `withArgValidation`); every tool handler is wrapped so a bad type returns `INVALID_INPUT` instead of `INTERNAL_ERROR`. Bounds: `topK` 1..200 (find_symbol, get_callers, get_callees, get_references), 1..100 (find_pattern), 1..`semanticSearch.maxTopK` (semantic_search, schema max 50); `maxDepth` 1..3; `maxFiles` 1..200; `startLine` 1..10,000,000; `endLine` startLine..10,000,000; `contextLines` 0..200; `minScore` 0..1 (float). Integer args are declared `type: 'integer'` with `minimum`/`maximum`. Behavior change: explicit `0` is now clamped to the minimum (or kept, for `contextLines`) instead of falling back to the default. Tests: `tests/unit/server/args.test.ts`, `tests/unit/server/tool-numeric-args.test.ts`. `npm test` 38 files / 247 tests passing; `grep -rn "as number" src/server/tools` empty.
- 2026-10-06: task created.
