---
id: M1-02
title: Generic symbol extraction engine driven by tags.scm queries
status: pending
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

- [ ] Golden tests on the `ts-basic`, `py-basic`, `go-basic` and `polyglot-basic` fixtures: the extracted (name, kind, line) set equals the current output, or every difference is listed in *Progress notes* and approved.
- [ ] `npm run test:perf` indexing throughput is no more than 10% slower than before.
- [ ] Hand-written `symbolNodeTypes` / `extractSignature` / `extractDocComment` are removed from the three profiles (or reduced to documented overrides).

## Verification

```bash
npm test && npm run test:e2e && npm run test:perf
```

## Progress notes

- 2026-10-11: started (branch `rebuild/m1-m2`). Scope extended by ADR 0001: this task also upgrades `web-tree-sitter` to 0.25.10 (exact pin), because the tags engine needs the `Query` API of the new runtime.
- 2026-10-06: task created.
