---
id: M0-06
title: Prevent ReDoS and event-loop blocking in find_pattern
status: todo
priority: P1
depends_on: [M0-01]
updated: 2026-10-06
---

## Context

`src/server/tools/find-pattern.ts`:
- `:34-45` each `$$$X` becomes a greedy `.+`; several in a row cause polynomial backtracking. Example: `$$$A $$$B $$$C;` against a minified file with very long lines.
- All matching runs **synchronously** on the main thread and rescans the whole project on every call (`scanProject`), so the server cannot answer any other request meanwhile.
- Two functional bugs in the same file:
  - `:124` `filePattern` is matched against the **absolute path**, so globs like `src/**/*.ts` never match.
  - `:139` line numbers are 0-based while every other tool is 1-based.
- Line numbers are computed with `source.substring(0, m.index).split('\n')` per match — quadratic cost.

## Scope

1. **Failing tests first:**
   - A pathological pattern on a fixture with a single ~50KB line returns within the time budget (with `truncated: true`), and **meanwhile** a concurrent `index_status` call is answered in < 500ms.
   - `filePattern: "src/**/*.ts"` matches files under `src/`.
   - Returned line numbers match those used by `get_context` (1-based).
2. Input limits (constants in the file): pattern length ≤ 500 chars, ≤ 8 placeholders total, ≤ 3 `$$$`; exceeding any → `INVALID_INPUT`.
3. Run matching **off the main thread** (dedicated worker thread) with a default 3000ms budget; on timeout terminate the worker and return results so far + `truncated: true` + a reason.
4. Skip lines longer than 4,000 characters (typically minified/generated code).
5. Match `filePattern` against the path **relative** to `projectRoot`, using `/` on every OS.
6. Compute line numbers from a precomputed line-start offset table + binary search.

## Out of scope

- Replacing it with an AST-based structural matcher (ast-grep) — idea for after M0.

## Acceptance criteria

- [ ] The 3 failing tests turn green.
- [ ] Over-limit patterns are rejected with a message naming the limit.
- [ ] The tool description and `inputSchema` state the limits and that lines are 1-based.

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-06: task created.
