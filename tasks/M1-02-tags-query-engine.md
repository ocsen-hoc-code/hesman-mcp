---
id: M1-02
title: Generic symbol extraction engine driven by tags.scm queries
status: done
priority: P0
depends_on: [M1-01]
updated: 2026-10-11
---

## Context

Each language currently needs a hand-written profile (`src/parsers/profiles/*.ts`): `symbolNodeTypes`, `extractSignature`, `extractDocComment`, plus regex-based relation extraction (`src/parsers/relation-extractor.ts`). This does not scale to hundreds of languages.

Most tree-sitter grammars ship a `queries/tags.scm` file following a shared convention (`@definition.function`, `@definition.class`, `@definition.method`, `@reference.call`, `@name`, …). GitHub code navigation and aider's repo map both rely on it, so one generic engine plus a per-language query file covers most languages.

## Scope

1. An engine that runs a language's `tags.scm` query and produces:
   - **definitions** → symbols, with the capture suffix mapped to Hesman kinds (`function`, `method`, `class`, `interface`, `module`, `type`, `constant`, …; unknown suffixes map to a generic kind instead of being dropped);
   - **references** → reference relations.
2. Generic helpers that work for every language:
   - signature = the first line of the definition node, trimmed and length-capped;
   - doc comment = contiguous comment nodes (node type contains `comment`) directly above the definition.
3. Registry entries (from M0-03) gain an optional `tagsQuery` path. Vendor queries under `queries/<lang>/tags.scm` with license attribution in `NOTICE`.
4. Migrate TypeScript, Python and Go to the engine. A language may still register a small override hook, but only with a written reason in the code.

## Out of scope

- Call/import relation queries for new languages (M1-07).
- Grammar download (M1-05).

## Acceptance criteria

- [x] Golden tests on the `ts-basic`, `py-basic`, `go-basic` and `polyglot-basic` fixtures: the extracted (name, kind, line) set equals the current output, or every difference is listed in *Progress notes* and approved.
- [x] `npm run test:perf` indexing throughput is no more than 10% slower than before.
- [x] Hand-written `symbolNodeTypes` / `extractSignature` / `extractDocComment` are removed from the three profiles (or reduced to documented overrides).

## Verification

```bash
npm test && npm run test:e2e && npm run test:perf
```

## Progress notes

- 2026-10-11: merged into `rebuild/m1-m2` (merge of `273bcf5`). Verified in a fresh clone with `npm ci` (web-tree-sitter 0.25.10): 0 type errors, `npm test` 95 files / 1092 tests + 1 skipped, twice in a row, after replacing the fixed 3 s sleeps in the two legacy e2e files with `waitForIndexReady` (`05215e7`).
- 2026-10-11: done. Part A (runtime upgrade + leak fixes) is commit `bd2a012`; Part B (engine, queries, migration) is the commit that adds this note.
  - **Runtime:** `web-tree-sitter` 0.25.10 (exact pin) loads the three committed grammars; the whole suite passed on it before the engine work started. One `Parser` per language is reused and trees are deleted after extraction. Verified on Node 24.5 only (no Node 20 on the machine).
  - **Engine:** `src/parsers/tags-engine.ts` (`TagsQuery`, `signatureOf`, `docCommentAbove`), suffix → kind table in `src/parsers/symbol-kinds.ts`, `tagsQuery` on registry entries, queries under `queries/` with provenance in `queries/SOURCES.json` and `NOTICE`. Layer rule: the earliest pattern that tags a name wins, so Hesman gap fillers (`hesman-tags.scm`, listed last) add definitions and never change what upstream tags.
  - **Queries:** upstream `tags.scm` of tree-sitter-javascript v0.23.1, -typescript v0.23.2, -python v0.23.6, -go v0.23.4 (all MIT, unmodified, sha256 checked by a test). Gaps filled for Hesman: TypeScript type aliases, enums, `namespace` blocks, methods upstream skips (`constructor`, `#private`, computed), plain variable declarators; Go constants and variables.
  - **Overrides kept (reasons in the profile files):** Python `extractDocComment` (docstrings are inside the body); TypeScript `includeDefinition` drops body-less signatures (`function_signature`, `method_signature`, `abstract_method_signature`) that the upstream query tags, because a signature next to its implementation makes the M0-13 call resolver see two same-named callables and unlink the call.
  - **Golden tests:** `tests/unit/parsers/golden/*.json` was recorded with the hand-written profiles before the migration; `golden-symbols.test.ts` asserts the engine reproduces (file, name, kind, startLine, endLine, isExported) exactly. Differences on the four fixtures: **none** (14 + 12 + 14 + 9 symbols).
  - **Differences outside the fixtures** (measured by running the old and the new extractor over this repository's `src/`, `tests/` and `scripts/`, 177 files, excluding the files this task rewrote; pinned by `tags-migration.test.ts`). They are why `INDEX_SCHEMA_VERSION` went 3 → 4 (M1-04 took 3 first; reconciled when merging `rebuild/m1-m2`):
    1. *Kind change, ids change:* a declarator whose value is a function (`const f = () => ...`, `const f = function () {}`) is `function`, was `variable` (50 symbols). Reason: the upstream JavaScript query tags it as `@definition.function` and upstream wins over the gap filler. Side effect on the call graph: calls inside such a function are now attributed to it instead of to the enclosing named function.
    2. *Removed:* destructuring declarations (`const { a, b } = x`) were indexed as one variable literally named `{ a, b }` (132 symbols). Only identifier names are indexed now.
    3. *Added:* functions assigned to an object key or to a property (`{ onClick: () => ... }`, `module.exports.h = function ...`) as `function` (36 symbols); class expressions; abstract classes; `namespace`/`module` blocks; Python module-level assignments as `constant`; every name of a multi-name Go `const`/`var` (only the first was indexed before).
    4. *Stored text, not ids:* doc comments lose their comment markers in TypeScript (`/** Adds */` → `Adds`); a one-line TypeScript/Go definition keeps a `{` that is part of a parameter type in its signature (the old code cut at the first `{`); Python definitions without a docstring fall back to `#` comments above.
    Local variables inside function bodies are still indexed, as before; trimming them is a separate decision.
  - **Calls/references:** the engine returns `@reference.*` captures (`TagsQuery.references`), but nothing stores them yet: call extraction is still the regex pipeline in `relation-extractor.ts` + `call-resolver.ts`, untouched, and every call-graph test passes. Feeding `@reference.call` into it is left to M1-07.
  - **Perf:** `parse + sqlite upsert (1 file)`: 3,865 files/s before (0.22.6, hand-written profiles) → 4,270 files/s after. Extracting this repository (177 files, one process): 1,309 ms with the old extractor, 240 ms with the engine.
  - **Verification** (after merging `rebuild/m1-m2` at `465ad61`): `npm run typecheck` clean; `npm run lint` 0 errors / 36 warnings (baseline); `npm test` 95 files, 1092 passed + 1 skipped; `npm run test:e2e` and `npm run test:perf` pass. One line outside this task's files changed in the merge: `tests/unit/stores/sqlite-text-files.test.ts` asserted the schema version is exactly 3 and now asserts it is at least 3.
- 2026-10-11: started (branch `rebuild/m1-m2`). Scope extended by ADR 0001: this task also upgrades `web-tree-sitter` to 0.25.10 (exact pin), because the tags engine needs the `Query` API of the new runtime.
- 2026-10-06: task created.
