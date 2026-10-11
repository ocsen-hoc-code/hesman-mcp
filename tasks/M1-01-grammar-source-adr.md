---
id: M1-01
title: Choose grammar source and distribution (spike + ADR)
status: done
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

- [x] The ADR is merged with a clear decision and rejected alternatives.
- [x] Prototype results (load OK / failed, parse time, size) for all 10 languages are recorded in *Progress notes*.
- [x] The `web-tree-sitter` version decision is recorded.

## Verification

Review of the ADR by the project owner.

## Progress notes

- 2026-10-11: **done.** The owner approved the ADR; decisions are recorded in its section 10 (`web-tree-sitter` pinned to 0.25.10, 16-grammar core set, background downloads with an offline switch, three-tier model, MIT-compatible queries only). The bulk build of all 372 grammars was not measured and moves to M1-05.
- 2026-10-11: **awaiting owner approval of the ADR.** `docs/adr/0001-grammar-distribution.md` is written with
  status `Proposed`; the task stays `pending` until the owner approves it (and answers its open questions).
  The `web-tree-sitter` decision in the ADR (upgrade to an exact pin of 0.27.1) is a proposal until then.
- 2026-10-11: prototype results. Upstream release `.wasm` per language, one process per grammar, macOS arm64,
  Node v24.5.0, script `scripts/experiments/grammar-spike.mjs`. Parse time is the median of 25 parses of a
  300–500 byte sample. "0.22.6" and "0.27.1" are `web-tree-sitter` versions.

  | Language | Grammar | WASM bytes | ABI | 0.22.6 | 0.27.1 | Load / parse on 0.27.1 | Tags query on 0.27.1 |
  |---|---|---:|---:|---|---|---|---|
  | Java | tree-sitter-java v0.23.5 | 414,641 | 14 | OK | OK | 1.5 ms / 0.102 ms | upstream: 5 defs, 5 refs |
  | C# | tree-sitter-c-sharp v0.23.5 | 5,350,581 | 15 | failed (ABI 15) | OK | 3.2 ms / 0.141 ms | upstream: 5 defs, 2 refs |
  | C++ | tree-sitter-cpp v0.23.4 | 3,434,931 | 14 | OK | OK | 2.8 ms / 0.124 ms | upstream: 6 defs, 0 refs |
  | Rust | tree-sitter-rust v0.24.2 | 1,118,099 | 15 | failed (ABI 15) | OK | 1.8 ms / 0.123 ms | upstream: 10 defs, 5 refs |
  | PHP | tree-sitter-php v0.25.1 | 1,081,285 | 15 | failed (ABI 15) | OK | 1.8 ms / 0.128 ms | upstream: 8 defs, 2 refs |
  | Ruby | tree-sitter-ruby v0.23.1 | 2,106,352 | 14 | OK | OK | 2.3 ms / 0.102 ms | upstream: 5 defs, 23 refs |
  | Kotlin | fwcd/tree-sitter-kotlin 0.3.8 | 4,052,625 | 14 | OK | OK | 3.0 ms / 0.201 ms | xberg bundle query: 10 defs, 5 refs |
  | Swift | alex-pinkus/tree-sitter-swift 0.7.3 | 3,825,025 | 15 | failed (ABI 15) | OK | 3.4 ms / 0.155 ms | upstream: 13 defs, 0 refs |
  | Bash | tree-sitter-bash v0.25.1 | 1,358,224 | 15 | failed (ABI 15) | OK | 2.0 ms / 0.073 ms | none upstream; 2-line spike query: 2 defs, 5 refs |
  | Lua | tree-sitter-grammars/tree-sitter-lua v0.5.0 | 54,603 | 15 | failed (ABI 15) | OK | 1.3 ms / 0.106 ms | upstream: 4 defs, 5 refs |

  "failed (ABI 15)": `Language.load` succeeds but `setLanguage` throws
  `Incompatible language version 15. Compatibility range 13 through 14.` On 0.22.6 the four ABI 14 grammars
  load in 1.2–2.2 ms, parse in 0.102–0.194 ms and return the same tags as on 0.27.1.
- 2026-10-11: other measurements (details and sources in the ADR): 104 of 372 catalog grammars publish a
  `.wasm` on their latest upstream release (34 ABI 14, 70 ABI 15; 0.22.6 loads 34, 0.25.10 and 0.27.1 load
  104); 65 of 372 ship an upstream `tags.scm`; the `@kreuzberg`/`@xberg-io` WASM package holds 32 languages in
  one 54 MiB module, and its 372-language catalog exists only as runtime-downloaded native libraries;
  `tree-sitter-wasms` 0.1.13 does not load in `web-tree-sitter` 0.26+; type-checking `src/` against 0.27.1
  gives 6 errors in 4 files, fixed by a 7-line patch (tried in a scratch copy, not applied here).
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
