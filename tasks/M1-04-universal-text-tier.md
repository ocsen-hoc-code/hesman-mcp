---
id: M1-04
title: Universal text tier for files without a grammar
status: todo
priority: P1
depends_on: [M1-03]
updated: 2026-10-06
---

## Context

No grammar collection covers every language, and some grammars may be unavailable offline. "Support every language" therefore needs a floor: **every text source file is indexed at some level**, even without a parser. Today, files with an unknown extension are skipped entirely by `src/indexing/project-scanner.ts`.

## Scope

1. Files not covered by a grammar (unknown extension, or grammar unavailable) are indexed as text:
   - chunk by blank-line-separated blocks, capped at a maximum number of lines per chunk;
   - store chunks for FTS and semantic search;
   - `get_context`, `semantic_search` and `find_pattern` work on them.
2. Skip binaries (NUL byte in the first 8 KB) and respect the existing size limit and ignore rules.
3. Language label from a broad extension table (e.g. derived from GitHub Linguist data), defaulting to `text`.
4. Results from this tier carry `precision: "text"` so agents know they are not symbol-accurate.

## Out of scope

- Symbol extraction for these files (that is what adding a grammar is for).

## Acceptance criteria

- [ ] A fixture file with an extension that has no grammar is found by `semantic_search` and `find_pattern`, and `get_context` returns its lines.
- [ ] A binary file in the fixture is skipped.
- [ ] Results from this tier are marked `precision: "text"`.

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-06: task created.
