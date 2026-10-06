---
id: M0-16
title: Better semantic_search ranking, measured on a labeled query set
status: done
priority: P1
depends_on: [M0-12]
updated: 2026-10-06
---

## Context

Found by the real-client smoke test (M0-12): for the query "format a person name for a greeting" on `polyglot-basic`, the top 3 were `main` (0.959), `tsMain` (0.865) and `GoFormatName` (0.798); `py_format_name` and `tsFormatName` ranked 5th and 6th. Entry points outrank the functions that actually match the intent. Tuning for one query would overfit, so this task introduces a small labeled evaluation and improves ranking against it.

Relevant code: `src/parsers/chunker.ts` (what text is embedded per symbol), `src/stores/zvec.ts` (`search`, score mapping, `matchType`), `src/server/tools/semantic-search.ts`, `src/stores/embedding.ts`.

## Scope

1. A labeled query set (≥ 8 queries) over `polyglot-basic` (extend the fixture with a few more realistic functions if needed), each with the expected symbol(s). Examples: "format a person name" → `*FormatName`/`py_format_name`; "build a greeting message" → `*Greet`/`py_greet`; "program entry point" → `main`/`tsMain`/`py_main`.
2. A test that reports hit@3 and MRR and asserts thresholds (target: hit@3 = 100% on this set). It must run offline once the model is cached; skip with a clear reason if the embedding model cannot be loaded.
3. Improve ranking until the thresholds pass. Candidate levers (measure each): embed name tokens split from camelCase/snake_case together with signature and doc comment; down-weight or exclude very small wrapper bodies dominated by calls; hybrid scoring that blends vector similarity with a lexical match on name/signature tokens (FTS in SQLite or ZVec); deduplicate per symbol.
4. Keep the response schema compatible; scores stay in [0, 1].
5. Record before/after metrics in *Progress notes*.

## Out of scope

- Changing the embedding model, or the line-number convention (M0-14 changes slicing in `chunker.ts` / `index-coordinator.ts`; do not change those slice indexes here).

## Acceptance criteria

- [x] The labeled evaluation passes its thresholds; before/after hit@3 and MRR are recorded.
- [x] For "format a person name for a greeting" the top 3 contain only `*FormatName` / `*Greet` functions (never an entry point such as `main` / `tsMain` / `py_main`) and at least one `*FormatName`. (Revised 2026-10-06: the original "exactly the three *FormatName" criterion was over-specific — `*Greet` legitimately builds a greeting from a name, and meeting it required a lexical weight that broke the decoy queries.)
- [x] Function-local variables (e.g. `total`, `err`, `clamped`) no longer crowd `semantic_search` results; measured on the labeled set.

## Verification

```bash
npm test
```

## Progress notes

- 2026-10-06: **done.** Merged `rebuild/m0-foundation` (M0-14 1-based slices kept alongside the embedded-text change; no conflicts).
  - Criterion 2 revised by the coordinator (see the criterion). The former `it.fails` test is now a normal test of the revised criterion; it passes: top 3 = `py_greet`, `GoGreet`, `tsFormatName`.
  - Criterion 3: `chunkSymbols` now skips variables/constants that lie strictly inside the source range of a function or method in the same file (the parser's `parent_id` points at the enclosing class, not the function, so nesting is decided by range). `src/parsers/core.ts` is unchanged, so SQLite and the other tools still see these symbols; module-level constants (`EMAIL_PATTERN`), class fields and nested functions stay in the semantic index.
  - Measured on the 14-query set: hit@3 1.000 -> 1.000, MRR 0.952 -> 0.952 (the locals never ranked first); function-local variables in the top 3 across all queries: 5 -> 0 (`total` x4, `clamped` x1 before); in the top 10: present -> none (asserted by a new test). Decoy "reduce the total price by a percentage": runner-up was the local `total` (0.333 vs `applyDiscount` 0.340), now `calculateCartTotal` (0.330).
- 2026-10-06: **pending — criterion 2 not met** (the labeled evaluation passes; see below).
  - Eval: `tests/integration/semantic-ranking.test.ts` over the new fixture `tests/fixtures/semantic-ranking/` (a copy of `polyglot-basic` plus `ts/cart.ts`, `ts/validate.ts`, `py/config.py`, `py/text.py`, `go/retry.go`, `go/query.go`). 14 labeled queries, run through the real `semantic_search` handler with the real model; thresholds hit@3 = 1.0 and MRR >= 0.9; skipped with a logged reason if the model cannot load. Includes two lexical-decoy queries ("reduce the total price by a percentage" -> `applyDiscount`, "validate the format of an email address" -> `isValidEmail`) where a query word appears in a wrong symbol's name, to guard against over-weighting name matches.
  - Root cause of the smoke-test ranking: ZVec's COSINE metric returns a **distance** (1 - cos, range [0, 2]), but `search` treated it as a similarity and sorted descending, so the *least* similar of the topK came first (and scores could exceed 1). Pinned by a unit test in `tests/unit/stores/zvec.test.ts`.
  - Metrics on the 14-query set (hit@3 / MRR):
    | Lever | hit@3 | MRR |
    |---|---|---|
    | Baseline (distance sorted as similarity) | 0.071 | 0.139 |
    | Score fix only (similarity = 1 - distance, clamped to [0, 1]) | 0.929 | 0.911 |
    | Score fix + hybrid name match (w = 0.3), no name words embedded | 1.000 | 0.869 |
    | Score fix + name words embedded (`function go format name` line), no hybrid | 0.929 | 0.946 |
    | Score fix + name words + hybrid w = 0.3 (**shipped**) | 1.000 | 0.952 |
    | ... hybrid w = 0.4 | 1.000 | 0.917 |
    | ... hybrid w = 0.5 / 0.6 / 0.7 | 1.000 | 0.952 |
    | Name words, signature/doc only (no body), w = 0 / 0.3 — measured on the first 12 queries, before the decoys were added | 0.917 / 1.000 | 0.896 / 0.903 |
    | Name words repeated twice, w = 0 / 0.3 | 0.929 / 1.000 | 0.911 / 0.917 |
  - Shipped: (1) score fix; (2) the embedded text starts with `<kind> <name split into words>` (`splitIdentifier` in `chunker.ts`); (3) hybrid score `0.7 * vector + 0.3 * lexical`, where lexical = share of the query's content words (stop words removed, light stemming) found in the split symbol name; results matching lexically get `matchType: 'both'`, others `'semantic'`. ZVec fetches max(5 * topK, 50) candidates when re-ranking or filtering by `filePattern`, then cuts to topK (the file filter used to run after the topK cut and could return too few results). Response schema unchanged; scores stay in [0, 1]. Existing indexes keep the old embedded text until their files are re-indexed.
  - Criterion 2: for "format a person name for a greeting" the top 3 are `py_greet`, `GoGreet`, `tsFormatName`. The `*Greet` functions are described as building "a greeting for the given name" and call `*FormatName`, so the model ranks them higher; `GoFormatName` (doc: "trims surrounding whitespace") has vector similarity 0.23 vs 0.50-0.56 for the Greet functions. Only w >= 0.6 puts all three `*FormatName` first, and from w = 0.4 the decoy query drops `applyDiscount` from rank 1 to rank 3, so that weight would be tuning to one query. The test is kept as `it.fails` and flips red once the ranking meets the criterion. Untried candidates: down-weighting call-dominated wrapper bodies (needs relation data in the chunker), a second embedding of the name words only (ZVec schema change). The local-variable symbols (`total`, `clamped`, `err`) that crowd the results come from the parser (out of scope here).

- 2026-10-06: task created from the M0-12 smoke test findings.
