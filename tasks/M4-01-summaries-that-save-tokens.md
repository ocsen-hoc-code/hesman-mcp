---
id: M4-01
title: List and call-graph responses that actually save tokens
status: pending
priority: P0
depends_on: [M0-15]
updated: 2026-10-13
---

## Context

Hesman's stated purpose is to cut the tokens an agent spends. Today only `get_context` does: list and call-graph tools (`get_references`, `get_callers`, `get_callees`, `list_dependencies`, `get_file_structure`, `find_symbol`, `impact_analysis`) return their plain JSON payload and report `_meta.reduction: "0.0%"`. The "smart summarization" layer in `src/server/response-compressor.ts` only added a `_summary` next to the full list, which made responses larger, so it is dropped (M0-15).

The cost of these responses is mostly repetition: every row repeats a long absolute or project-relative `filePath`, the same `kind` / `language` strings, null fields, and pretty-printed key names.

## Scope

1. **Measure first.** Build a fixed, reproducible benchmark (a script plus a committed expectation file or a test) that calls every tool through the real handlers on this repository's `src/` (or a committed fixture large enough to have long lists) with representative arguments, and records tokens per response with the estimator `_meta` already uses. This is the baseline and the regression guard.
2. **Make the default response smaller without losing information an agent needs.** Candidates, to be chosen by measurement, not assumed:
   - group rows by file so the path is written once (`{ file, items: [...] }`), and write paths relative to the project root;
   - drop fields that are null, empty or constant across the list, and state the constant once at the top level;
   - shorter but still self-explanatory row shapes (for example `line` instead of `startLine` + identical `endLine`);
   - an honest `_summary` (counts by kind / by file) **instead of** rows beyond a limit, with `hasMore` / `nextCursor` so the agent can page — never in addition to the full list.
   A response must never be larger than the plain payload, and `_meta.reduction` must keep being computed against the plain payload.
3. **Keep agents able to read it.** The shape must stay documented in `docs/TOOLS.md`, be stable, and be obvious without the docs (no positional arrays of unnamed values, no single-letter keys). Tool `inputSchema` descriptions must mention any new parameter. If a shape changes, the dashboard (`src/ui/public/js/**`, its mock and `tests/unit/ui/smoke.test.ts`) and `RULES_BLOCK` must follow.
4. **A way to get the full plain payload** when an agent wants it (for example `format: "full"`), tested.
5. Report measured savings per tool; update `CHANGELOG.md` and `docs/TOOLS.md`. Do not edit `README.md` or its translations: put the numbers and the proposed README wording in the report (another task rewrites the README).

## Out of scope

- Using a language model to summarise.
- Changing what is indexed.

## Acceptance criteria

- [ ] The benchmark exists, is deterministic, and its numbers are in the report (tokens before/after and reduction per tool).
- [ ] At least `get_references`, `get_callers`, `get_callees`, `get_file_structure`, `list_dependencies` and `find_symbol` return fewer tokens than their plain payload on lists of 10 or more rows, with no information loss that the report cannot justify; `_meta.reduction` shows it.
- [ ] No tool response is ever larger than its plain payload (test over the benchmark set).
- [ ] The full payload is still reachable and paging works.
- [ ] The dashboard playground and graph views still work with the new shapes (unit tests green; the mock matches).

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-13: task created (owner asked to make summaries save tokens); started.
