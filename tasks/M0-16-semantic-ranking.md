---
id: M0-16
title: Better semantic_search ranking, measured on a labeled query set
status: todo
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

- [ ] The labeled evaluation passes its thresholds; before/after hit@3 and MRR are recorded.
- [ ] For "format a person name for a greeting" the top 3 are the three `*FormatName` functions.

## Verification

```bash
npm test
```

## Progress notes

- 2026-10-06: task created from the M0-12 smoke test findings.
