---
id: M0-05
title: Safe ZVec filters; validate kind/language
status: done
priority: P1
depends_on: [M0-03]
updated: 2026-10-06
---

## Context

`src/stores/zvec.ts` string-interpolates values into filter expressions:
- `:171` `` deleteByFilterSync(`filePath = '${filePath}'`) ``
- `:178` `` `language = '${params.language}'` `` and `:179` `` `kind = '${params.kind}'` `` — both come straight from `semantic_search` tool arguments (`src/server/tools/semantic-search.ts:31-32`) without validation.

Consequences:
- **Injection** into the filter expression from agent input.
- **Correctness bug:** a path containing `'` (e.g. `O'Brien/src/a.ts`) breaks the delete, so stale vectors survive and search returns code that was edited or deleted.

## Scope

1. **Failing tests first:**
   - `semantic_search` with `kind: "function' OR '1'='1"` must return `INVALID_INPUT`.
   - Index a file inside a directory containing `'`, edit it, re-index → no stale documents remain in ZVec.
2. `semantic_search`: validate `kind` against the fixed kind list (same enum as `find_symbol`) and `language` against the registry ids (M0-03); add `enum` to `inputSchema` so agents see the valid values.
3. `zvec.ts`:
   - Read the `@zvec/zvec` filter grammar (docs or source in `node_modules`) to determine the exact string-escaping rules.
   - If safe escaping exists → route every value through a single `quoteFilterValue()`.
   - If not → `deleteByFile` deletes by id list instead (fetch symbol ids from SQLite before `clearSymbols`), provided ZVec has a delete-by-id API.
   - The store validates again (defense in depth) rather than trusting the tool layer.

## Out of scope

- Replacing ZVec (backlog).

## Acceptance criteria

- [x] Both failing tests turn green.
- [x] No template string in `src/stores/zvec.ts` interpolates an unescaped value into a filter.
- [x] *Progress notes* record the verified escaping rules, with their source.

## Verification

```bash
npm test
grep -n "Filter\|filter" src/stores/zvec.ts
```

## Progress notes

- 2026-10-06: done. Both tests from the scope are green: `tests/unit/server/semantic-search-args.test.ts` (injected `kind` / unknown `language` → `INVALID_INPUT`, enums in `inputSchema`) and `tests/integration/zvec-stale-docs.test.ts` (file under `O'Brien/`, edited and re-indexed, single-threaded and worker-pool paths). Extra unit tests in `tests/unit/stores/zvec.test.ts`.
  - **Root cause of the stale vectors was larger than the quoting bug:** `deleteByFile` was never called anywhere, and symbol ids include the start row, so every edit that shifted lines left orphaned documents. `index-coordinator.ts` (both paths) and `file-watcher.ts` (change + unlink) now call `zvecStore.deleteByFile(path, idsFromSqlite)` before `clearSymbols`.
  - **Verified ZVec 0.5.0 filter escaping rules.** Not documented: `node_modules/@zvec/zvec/README.md` and `src/index.d.ts` only describe `filter` as a "boolean expression". Strings in the native binding (`@zvec/bindings-darwin-arm64/zvec_node_binding.node`: `antlr4::SQLParser`, `SQUOTA_STRING`, `DQUOTA_STRING`, `ESCAPED_CHAR`, `quoted_string`) show an ANTLR SQL grammar. Behavior was then verified empirically with `querySync` against a scratch collection:
    - `'O\'Brien'` matches `O'Brien`; SQL-style `'O''Brien'` is a syntax error; `"O'Brien"` also works.
    - `\` + any char lexes as one unit, but unescaping only turns `\'` / `\"` into the quote; all other backslashes stay verbatim (`'back\slash'` matches `back\slash`, `'back\\slash'` matches `back\\slash` (two backslashes), `'x\\'` does not match `x\`, `'x\'` is a lexer error). No `\n` / `\u` escapes.
    - A raw newline inside a literal is a lexer error; `--` and `/* */` start comments outside literals.
    - Conclusion: `quoteFilterValue()` escapes `'` as `\'` and rejects any value containing `\` or a control character (U+0000-U+001F, U+007F).
  - `deleteByFile(filePath, symbolIds)` deletes by id via `deleteSync(ids)` (works for every path, e.g. Windows paths with `\`) and additionally by quoted filter when the path is quotable (catches documents SQLite no longer knows about).
  - `ZVecStore.search` re-validates `kind` / `language` (defense in depth) before quoting them.
  - Deviation: the kind list lives in new `src/parsers/symbol-kinds.ts` (`SYMBOL_KINDS`) and adds `constant` (emitted by the Go profile) to the 8 kinds of `find_symbol`. `find_symbol` still has its inline enum (file not owned by this task) — follow-up: import `SYMBOL_KINDS` there.
- 2026-10-06: task created.
