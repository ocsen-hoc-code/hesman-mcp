---
id: M0-15
title: Accurate metadata — Go exports, index_status, token-reduction stats
status: done
priority: P1
depends_on: [M0-12]
updated: 2026-10-06
---

## Context

Found by the real-client smoke test (M0-12):
1. **Go `isExported` is wrong:** `GoGreet` and `GoFormatName` (capitalized, therefore exported in Go) report `isExported: false` (`is_exported 0` in SQLite). See `src/parsers/profiles/go.ts` and how `src/parsers/core.ts` sets `is_exported`.
2. **`index_status` is misleading:** it reports `languages: []` although TypeScript, Python and Go are indexed, and a `kuzuOk: false` health flag although Kuzu is not part of Hesman (`src/server/tools/index-status.ts`).
3. **Negative token reduction:** `_meta.reduction` was -64.8% for a small `get_callers` response and -294.4% for a small `get_context` response — the `_summary` / `_meta` overhead makes small outputs larger than the raw data, while Hesman advertises token savings (`src/server/response-compressor.ts`).

## Scope

1. **Failing tests first** for each item (unit and/or e2e with the harness on `polyglot-basic`).
2. Go: an identifier is exported iff its first character is an uppercase Unicode letter (Go spec); apply to functions, methods, types and constants. Check Python (`_`-prefixed = private convention) and TypeScript (`export`) behavior for consistency and fix if equally wrong.
3. `index_status`: report the indexed languages with file counts per language (from SQLite); remove `kuzuOk` and any other field that refers to components Hesman does not have; keep remaining fields backward compatible. Update `docs/TOOLS.md`.
4. Response compression: never make a response larger than its uncompressed form. If adding `_summary` or compressing does not reduce size, return the plain payload; `_meta.reduction` must never be negative (report 0 and, if useful, `compressed: false`). Keep the README's documented savings truthful (adjust wording only if a claim becomes inaccurate).

## Out of scope

- Search ranking (M0-16), call graph (M0-13), line numbers (M0-14).

## Acceptance criteria

- [x] `find_symbol('GoGreet')` reports `isExported: true`; a lowercase Go function reports `false`.
- [x] `index_status` on `polyglot-basic` lists typescript, python and go with file counts; no `kuzuOk`.
- [x] For every tool, `_meta.reduction ≥ 0` on the `polyglot-basic` fixture (test covers small responses of `get_callers` and `get_context`).

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-06: done. (1) `LanguageProfile.isExported?(name, node)` hook; `core.ts` uses it when present, else the `export_statement` rule. Go: exported iff the name starts with a Unicode uppercase letter (`\p{Lu}`) and is not declared inside a function body. Python was equally wrong (always `false`): now public unless `_`-prefixed (dunders public) and not nested in a function. TypeScript unchanged. (2) `index_status`: `languages` is `[{ language, files, symbols }]` from new read-only `SqliteStore.getLanguageStats()`; `health.kuzuOk` removed; other fields unchanged. (3) `compressToolResponse` keeps compaction/`_summary` only if the result is strictly smaller than the plain payload, otherwise returns the plain payload; baseline = max(plain payload, pre-pruning size), so `reduction` is never negative; `_meta.compressed` added. Since `_summary` is purely additive, it is now effectively never emitted; the two older tests asserting `_summary` on tiny inputs were updated. Tests: `tests/unit/parsers/exports.test.ts`, `tests/unit/server/compressor.test.ts`, `tests/unit/stores/sqlite.test.ts`, `tests/e2e/metadata.test.ts`. `npm test`: 58 files, 395 passed + 1 skipped; `npm run test:e2e`: 10 files, 47 passed.
- 2026-10-06: task created from the M0-12 smoke test findings.
