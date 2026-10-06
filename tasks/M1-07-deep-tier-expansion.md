---
id: M1-07
title: Expand the deep tier (call graph + imports) to the most-used languages
status: todo
priority: P2
depends_on: [M1-02, M1-03]
updated: 2026-10-06
---

## Context

Call graph and import relations power the tools that distinguish Hesman (`get_callers`, `get_callees`, `impact_analysis`, `list_dependencies`). In v1.0 they exist only for TS/Python/Go, and they are regex-based (`src/parsers/relation-extractor.ts`), which does not scale.

## Scope

1. Relation extraction for new languages uses **tree-sitter queries only** — no new regex extractors. Queries live next to `tags.scm` (e.g. `queries/<lang>/relations.scm`) and capture calls, imports, and extends/implements.
2. Proposed order (adjust using current language-popularity data, e.g. GitHub Octoverse): Java, C#, C, C++, Rust, PHP, Ruby, Kotlin, Swift.
3. Each language gets a fixture with calls and imports, and passes the deep-tier checks of the conformance suite (M1-03).
4. Split into one sub-task per language when work starts (`M1-07a-java.md`, …).
5. Optionally migrate TS/Python/Go relations from regex to queries, if it does not regress their tests.

## Out of scope

- Cross-language call resolution (e.g. FFI, RPC boundaries).

## Acceptance criteria

- [ ] Every language listed above is in the deep tier and passes conformance.
- [ ] `relation-extractor.ts` gains no new regex rules.

## Verification

```bash
npx vitest run tests/conformance/
```

## Progress notes

- 2026-10-06: task created.
