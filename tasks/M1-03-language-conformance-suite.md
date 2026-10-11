---
id: M1-03
title: Language conformance test suite
status: done
priority: P0
depends_on: [M1-02]
updated: 2026-10-11
---

## Context

Once languages are added as data rather than code, the only way to know a language actually works is a test that exercises every registry entry. Without it, a broken grammar or query fails silently — the same failure mode as Python/Go indexing 0 files in v1.0.

## Scope

1. Fixture layout: `tests/fixtures/languages/<lang>/` with at least one small, realistic source file per registered language.
2. One parameterized test that iterates over the registry and, for each language, asserts:
   - the grammar loads;
   - the fixture parses with `ERROR` nodes below a small threshold;
   - at least one symbol is extracted (structural and deep tiers);
   - at least one call relation is extracted (deep tier only).
3. A check that fails CI when a registry entry has no fixture.
4. Output a per-language pass/fail table in the test report so regressions are easy to spot.

## Out of scope

- Answer-quality evaluation (backlog).

## Acceptance criteria

- [x] The suite covers every language in the registry.
- [x] Removing a fixture or breaking a query makes CI fail with the language named.

## Verification

```bash
npm run test:conformance   # builds, then: vitest run tests/conformance/ tests/integration/language-conformance.test.ts
npx vitest run tests/conformance/   # in-process part only
```

## Progress notes

- 2026-10-11: done (the commit that adds this note, on the M1-03 worktree branch).
  - **Layout:** `tests/fixtures/languages/<id>/` holds the source files and an `expected.json` per registered language (`typescript`: `shapes.ts`, `widget.tsx`, `legacy.js`, `view.jsx`; `python`: `inventory.py`; `go`: `inventory.go`). `expected.json` lists, per file, the definitions that must be found (`name`, `kind`, `line`, `isExported`, optional `doc`), a `symbolCount` range, the expected `calls`, an optional `maxErrorNodes`, and `knownGaps` (documented expected failures; the suite fails when a listed gap starts passing).
  - **Suite:** `tests/conformance/languages.conformance.test.ts` iterates over `LANGUAGES` (helpers in `tests/conformance/helpers.ts`, no language is named in either). Per language: tier declared; grammar loads in the pinned runtime (ABI within the runtime's range, parses); every query layer compiles against that grammar; fixture directory + valid `expected.json`; each fixture parses with at most `maxErrorNodes` (default 0) ERROR/MISSING nodes; expected symbols; symbol count; non-empty signatures and expected doc comments; expected calls from the current relation pipeline (`deep` only). It also checks that the installed `web-tree-sitter` is the exact version pinned in `package.json` and that no fixture directory lacks a registry entry.
  - **Worker slice:** `tests/integration/language-conformance.test.ts` copies the fixtures to a temp project, indexes it with `indexProject` + `WorkerPool` + `SqliteStore`, and asserts per language: every fixture file has symbols stored under that language, the expected definitions are in the store, and (`deep`) the expected calls between fixture symbols are resolved (`getCallees`).
  - **Tier:** `LanguageDefinition.tier: 'deep' | 'structural'` (type `LanguageTier`) added to `src/parsers/languages.ts`; the three entries are `deep`. Nothing else reads it yet (M1-06).
  - **Table:** both files print a Markdown table (one row per language, one column per check, then the failures and the known gaps); `HESMAN_CONFORMANCE_REPORT=<dir>` also writes `conformance.{md,json}` and `conformance-indexing.{md,json}`.
  - **Scripts:** `npm run test:conformance` (with a `pretest:conformance` build, because the worker slice loads `dist/indexing/worker.js`); `npm test` collects both files as before. Deviation from the brief: the script also runs the integration file, since the v1.0 bug was only visible through the worker.
  - **`queries.test.ts`:** the per-language compile test now uses the suite's helpers (`loadGrammar`, `compileTagsQueries`), plus one new test that the error names the language, the query file and the grammar.
  - **What the JS/JSX/TSX fixtures showed** (TypeScript grammar for all four, as the registry maps them today): `legacy.js` parses cleanly; `view.jsx` has 11 and `widget.tsx` 14 ERROR/MISSING nodes. Symbols mostly survive the errors, except `BadgeList` in `widget.tsx` (an arrow-function component), which is indexed as `variable` instead of `function`. Recorded as known gaps `fixedBy: M1-05`; when M1-05 adds the `tsx` and `javascript` entries, move the files to their own directories and delete those gaps (the suite fails until both are done).
  - **Extraction findings, recorded as known gaps, not fixed here** (none is a missing pattern only; all change stored symbols and need an `INDEX_SCHEMA_VERSION` bump):
    1. TypeScript/JavaScript export rule (`isNodeExported` in `src/parsers/core.ts`): a declaration local to an exported function is reported as exported (`addArea` in `shapes.ts`, `increment` in `view.jsx`), and so is a `private` member of an exported class (`describe`).
    2. CommonJS `module.exports = { ... }` is not recognized as an export (`backoff`, `Retrier`, `createRetrier` in `legacy.js`).
    3. Python: the names of a tuple assignment (`LOW_STOCK, HIGH_STOCK = 5, 50`) are not indexed; the upstream query only tags `NAME = value`. A `queries/python/hesman-tags.scm` gap filler would fix it.
    Observed and not asserted: Python methods have kind `function` (upstream query; existing unit tests rely on it); the regex call extractor reports false calls such as `Stocker->Restock` (an interface method spec), `label->s` (from the string `"%s ("`) and `Shape->area`; a multi-line TypeScript constructor gets the signature `constructor(`.
  - **Mutation checks** (each reverted; the suite was green again afterwards):
    - (a) deleted `go/expected.json` → `[go] tests/fixtures/languages/go/expected.json is missing. Add it with one entry per fixture file (inventory.go): { "files": { ... } } (see docs/CONTRIBUTING.md, "Adding a Language").`; table row `go | fixtures FAIL`. Deleted the whole `python/` directory → `[python] is registered in src/parsers/languages.ts but has no fixture directory. Add tests/fixtures/languages/python/ with at least one small, realistic source file (.py, .pyw, .pyi) and tests/fixtures/languages/python/expected.json ...`.
    - (b) `(const_spec` → `(const_specification` in `queries/go/hesman-tags.scm` → `[go] Tags query queries/go/hesman-tags.scm does not compile for this grammar: Bad node name 'const_specification' (grammar: parsers/tree-sitter-go.wasm)` (conformance and `queries.test.ts`), and the worker slice: `[go] the worker pool indexed 0 symbols for 1 fixture file(s)`. A query that still compiles but uses the `name:` field on `const_spec` (the multi-name quirk) → `[go] inventory.go: expected non-exported constant "defaultName" at line 12 was not extracted` and `extracted 18 symbols, expected 19-19`.
    - (c) compiled worker patched to know only TypeScript (the v1.0 bug): the in-process table stayed all `pass`, the worker slice failed with `[python] the worker pool indexed 0 symbols for 1 fixture file(s): the language is registered but does not reach the store (errors: [".../go/inventory.go: Unsupported language: go", ".../python/inventory.py: Unsupported language: python"])` and the same for `[go]`. Engine patched to drop `method` definitions → `[typescript] shapes.ts: expected exported method "constructor" at line 32 was not extracted`, `[go] inventory.go: expected exported method "Restock" at line 45 was not extracted`, plus count, docs and calls failures for both languages; Python stayed green (its methods are functions).
    - (d) made a known gap pass (expected `BadgeList` as `variable`) → `[typescript] known gap no longer fails: widget.tsx BadgeList@25 ... Remove it from "knownGaps" in tests/fixtures/languages/typescript/expected.json`.
  - **Verification:** `npm run typecheck` clean; `npm run lint` 0 errors / 36 warnings (baseline); `npm test` 97 files, 1163 passed + 1 skipped, twice in a row (baseline 95 / 1092 + 1; +60 conformance, +10 worker slice, +1 in `queries.test.ts`); `npm run test:conformance` 2 files, 70 passed.
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
