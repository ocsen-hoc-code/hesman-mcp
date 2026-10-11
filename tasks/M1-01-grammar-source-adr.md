---
id: M1-01
title: Choose grammar source and distribution (spike + ADR)
status: pending
priority: P0
depends_on: [M0-12]
updated: 2026-10-11
---

## Context

Requirement: Hesman must support **every programming language**. Today it ships 3 committed WASM grammars (`parsers/`) and pins `web-tree-sitter` `^0.22.6`.

Candidate grammar sources (researched 2026-10-06, to be verified in this spike):
- `@kreuzberg/tree-sitter-language-pack-wasm` — reports 371 precompiled grammars, on-demand download with a shared cache, built-in symbol/chunk extraction.
- `tree-sitter-wasms` — prebuilt WASM for 40+ grammars, all built in one CI run.
- Building our own WASM from upstream grammar repos with the tree-sitter CLI in CI.

Known risks:
- **ABI compatibility:** grammars compiled by a newer tree-sitter CLI may not load in `web-tree-sitter` 0.22; upgrading `web-tree-sitter` may change its API.
- **Package size:** bundling hundreds of grammars could make the npm package very large.
- **Licenses:** each grammar and each `tags.scm` query carries its own license.
- **Supply chain:** downloaded grammars must be checksum-verified (see M0-10).

## Scope

1. For each candidate, measure and record: language count, per-grammar and total size, ABI version vs. the `web-tree-sitter` version we would use, license, update cadence, and how many languages also have a usable `tags.scm` query.
2. Prototype script (in the scratch area, not shipped) that loads 10 diverse grammars in Node via `web-tree-sitter` and parses a sample file for each: Java, C#, C++, Rust, PHP, Ruby, Kotlin, Swift, Bash, Lua.
3. Decide whether to upgrade `web-tree-sitter`, and estimate the migration cost if so.
4. Write `docs/adr/0001-grammar-distribution.md` covering:
   - which grammars ship inside the npm package (core set) vs. are fetched on demand;
   - cache location and versioning by ABI;
   - the offline story (e.g. `hesman grammars install --all`);
   - checksum manifest and update process;
   - license attribution (`NOTICE` file).

## Out of scope

- Implementing the distribution (M1-05) or the extraction engine (M1-02).

## Acceptance criteria

- [ ] The ADR is merged with a clear decision and rejected alternatives.
- [ ] Prototype results (load OK / failed, parse time, size) for all 10 languages are recorded in *Progress notes*.
- [ ] The `web-tree-sitter` version decision is recorded.

## Verification

Review of the ADR by the project owner.

## Progress notes

- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
