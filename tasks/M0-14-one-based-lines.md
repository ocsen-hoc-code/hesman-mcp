---
id: M0-14
title: One line-number convention — 1-based everywhere
status: todo
priority: P0
depends_on: [M0-12]
updated: 2026-10-06
---

## Context

Found by the real-client smoke test (M0-12): symbols are stored and returned **0-based** while `get_context` input and `find_pattern` output are **1-based**. In `polyglot-basic`, `py_greet` is on file line 5 but `find_symbol` reports `startLine 4`, and `py_format_name` reports `startLine 0`. An agent that passes a symbol's `startLine` to `get_context` lands one line early.

Sources of 0-based values:
- `src/parsers/core.ts:107-108` store `child.startPosition.row` / `endPosition.row` directly; `:249` parse errors use the raw row.
- `src/parsers/relation-extractor.ts:55` computes relation `line` 0-based.
- Consumers that index source arrays with these values: `src/parsers/chunker.ts:19`, `src/indexing/index-coordinator.ts:119,187` (`sourceLines.slice(start_line, end_line + 1)`), and any range comparison (`get_context` symbols-in-range, context pruner, impact analysis, response compressor).

## Scope

1. **Failing tests first:**
   - e2e (harness, `polyglot-basic`): `find_symbol('py_greet')` returns `startLine 5`; `get_context` with that `startLine` and `contextLines: 0` returns the `def py_greet` line; `find_pattern` and `find_symbol` agree on the line of `py_greet`.
   - Same agreement check for one TypeScript and one Go symbol.
2. Make **every** stored and returned line number 1-based: symbol `start_line`/`end_line`, relation `line`, parse-error lines, and every tool response field that carries a line.
3. Fix all consumers that index arrays or compare ranges (list above; grep for `start_line`, `end_line`, `.line`, `startLine`, `endLine`).
4. Existing indexes on users' machines hold 0-based rows: add an index schema version (e.g. in the SQLite `metadata` table) and force a full re-index (clear symbols, relations, file hashes and ZVec docs) when it is older.
5. Document the convention in `docs/TOOLS.md` ("all line numbers are 1-based, inclusive").

## Out of scope

- Call-graph resolution changes (M0-13 runs after this task and builds on the 1-based convention). In `relation-extractor.ts` change only the line base.

## Acceptance criteria

- [ ] The failing tests turn green.
- [ ] `grep -rn "startPosition.row\|endPosition.row" src` shows every use converted (or a comment explaining why not).
- [ ] Opening an index created before this change triggers a full re-index (test).
- [ ] `docs/TOOLS.md` states the convention.

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-06: task created from the M0-12 smoke test findings.
