---
id: M0-05
title: Safe ZVec filters; validate kind/language
status: todo
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

- [ ] Both failing tests turn green.
- [ ] No template string in `src/stores/zvec.ts` interpolates an unescaped value into a filter.
- [ ] *Progress notes* record the verified escaping rules, with their source.

## Verification

```bash
npm test
grep -n "Filter\|filter" src/stores/zvec.ts
```

## Progress notes

- 2026-10-06: task created.
