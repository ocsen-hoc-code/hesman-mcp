---
id: M1-05
title: Grammar delivery — bundled core set + verified on-demand download
status: pending
priority: P1
depends_on: [M1-01, M0-10]
updated: 2026-10-11
---

## Context

Implements the decision recorded in `docs/adr/0001-grammar-distribution.md` (M1-01). The working assumption, to be confirmed by the ADR: ship a core set of the most-used grammars in the npm package, and fetch the rest on first need so the package stays small while still covering every language.

## Scope

1. Bundle the core grammar set chosen in the ADR.
2. On-demand fetch of other grammars into a cache directory versioned by ABI (e.g. `~/.cache/hesman/grammars/<abi>/<lang>.wasm`), verified against a pinned sha256 manifest (reuse the checksum code from M0-10). A mismatch is never written to disk.
3. CLI: `hesman grammars list`, `hesman grammars install <lang...>`, `hesman grammars install --all` (for offline machines).
4. Grammar missing and fetch impossible (offline) → the file falls back to the text tier (M1-04) and the gap is reported by `index_status`; indexing never fails because of it.
5. Fetching happens in the background and never blocks the MCP request path.

## Out of scope

- Hosting our own grammar mirror (only if the ADR requires it).

## Acceptance criteria

- [ ] Fresh install, offline: bundled languages get full extraction, others get the text tier, and `index_status` lists what is missing.
- [ ] Online: a non-bundled language is fetched, verified and used on the next indexing pass.
- [ ] Tampered download (test with a wrong hash) is rejected and not cached.
- [ ] npm package size stays within the budget set in the ADR.

## Verification

```bash
npm test
npm pack --dry-run   # check package size
```

## Progress notes

- 2026-10-12: **first half done (scope item 1, the bundled core set); items 2-5 are still open, status stays `pending`.**
  - **Registry:** 3 -> 16 languages (`typescript`, `tsx`, `javascript`, `python`, `go`, `java`, `c`, `cpp`, `csharp`, `rust`, `php`, `ruby`, `kotlin`, `swift`, `bash`, `lua`). `.tsx` -> `tsx`; `.js/.jsx/.mjs/.cjs` -> `javascript`; `.ts/.mts/.cts` -> `typescript`. `INDEX_SCHEMA_VERSION` 4 -> 5.
  - **Grammars:** the `.wasm` asset of each grammar's own upstream GitHub release, pinned by URL + sha256 in `scripts/download-parsers.ts`, committed in `parsers/`. All 16 load in `web-tree-sitter` 0.25.10 (ABI 14: typescript, tsx, javascript, python, go, java, cpp, ruby, kotlin; ABI 15: c, csharp, rust, php, swift, bash, lua). Tags as in ADR 0001 section 3; C, not in that table, is `tree-sitter/tree-sitter-c` v0.24.2 (645,157 B). Deleting the 13 new files and running the script downloads them again with matching hashes.
  - **Budget:** `parsers/` is 27,327,695 B (limit 30 MB). `npm pack --dry-run`: 498.2 kB -> 2.70 MB gzipped (+2.2 MB, limit +3 MB), 3.1 MB -> 28.4 MB unpacked. C# (5.35 MB), Kotlin (4.05 MB), Swift (3.83 MB) and C++ (3.43 MB) are 61% of the directory; 2.67 MB of headroom is left.
  - **Queries:** upstream `queries/tags.scm` at the grammar tag, unmodified, for java, c, cpp, csharp, rust, php, ruby, swift, lua (javascript and typescript were already vendored; tsx uses the typescript layers). Kotlin: tag 0.3.8 has none; vendored the file the same repository added later (commit `b4cc392c`), which is byte-identical to the one in the xberg bundle 1.21.3 and compiles against the 0.3.8 grammar. Bash: no upstream query; `queries/bash/hesman-tags.scm` is written for Hesman. Gap fillers (`hesman-tags.scm`, listed last): javascript (methods upstream skips, plain variables), java (constructors, enums and their constants, records, annotation types, fields), c and cpp (`#define` with a value, function-like macros; cpp also namespaces), csharp (constructors, enums, structs, records, properties, fields, qualified and file-scoped namespaces), rust (`const`, `static`), php (`const`, enums), ruby (constants).
  - **New: override layers** (`hesman-overrides.scm`, listed *before* upstream so they win): c and cpp, because upstream tags a function at its `function_declarator` (one-line symbol, truncated signature, no doc comment); swift, because upstream puts the `@definition` capture of methods and properties on the enclosing type (every member started on the type's line). Removing them makes the conformance suite fail (checked). They keep upstream's kinds.
  - **Profiles:** `src/parsers/profiles/generic.ts` — `defineProfile()` plus one documented `isExported` rule per language; `tsxProfile` shares the TypeScript hooks.
  - **Tiers** (`deep` = every call between the fixture's definitions is found, in-process and resolved in the store, and no false self-call): deep — tsx, javascript, java, csharp, rust, php, kotlin, swift, lua. structural — c and cpp (prototype + definition are two same-named callables, so the M0-13 resolver cannot link cross-file calls), ruby (the fixture's `record :restock` call has no parentheses; the regex needs `name(`), bash (calls never have parentheses). Structural profiles have no `relationQueries`, so no relations are stored for them.
  - **Known limits, not fixed here (M1-07 / M1-08 material):** (1) Java and C#: `new X(...)` is not linked when the class declares a constructor, because class and constructor are two callables named `X` (measured; without a declared constructor it links to the class). (2) Kinds follow the upstream queries: PHP and Kotlin methods are `function`; Rust enums and type aliases, Swift enums/structs and Kotlin interfaces/enums are `class`; a Rust `fn` inside a `mod` block is `method`; Kotlin properties are `constant`; C/C++ enums are `type`; C++ member functions are `function`. (3) Known gaps in `expected.json`: Rust doc comment above an attribute; Kotlin doc comment right after the `package` line. (4) An interface method and its implementation are two same-named callables (Java, C#, Kotlin, Swift, PHP), so calls to such a method from another file stay unresolved, as TypeScript avoided by dropping signatures. (5) False unresolved calls from keywords the regex does not know (`foreach (`, `when (`, Lua `function(`), and from trait/interface signatures (`Stocker->restock` in Rust). (6) A Java method with an annotation on its own line gets the annotation as its signature.
  - **Text tier labels:** `.sh`/`.bash` are now `bash` (other shells stay `shell`), `.tsx` is `tsx`; a test checks that every registry extension is labelled with its registry id. The `text-tier` fixture's `deploy.sh` became `deploy.zsh`, since `.sh` is no longer a text-tier file.
  - **Timing** (one run, Node 24.5, Apple M3 Pro): grammar load 0.5-6.1 ms each; fixture parse 0.10-0.31 ms (median of 25); tags query compile per language 1-150 ms (cpp 148, swift 129, typescript 70), once per process or worker. `npm run test:perf` `parse + sqlite upsert (1 file)`: 4,032 -> 4,224 files/s (one run each; no measurable change).
  - **Verification:** `npm run typecheck` clean; `npm run lint` 0 errors / 36 warnings; `npm test` 101 files, 1541 passed + 1 skipped (baseline 1277 + 1); `npm run test:conformance` 2 files, 239 passed.
  - **For the second half:** the manifest can be generated from `PARSERS` + `queries/SOURCES.json` (bundled entries); `LanguageProfile.parserWasmPath` is a plain string computed in `defineProfile`, so a cache path can be substituted there; `text-languages.ts` already returns the registry id for every bundled extension, which is what a fallback to the text tier needs; `doctor` counts `LANGUAGES[].grammar`, so non-bundled entries must not be reported as missing parsers; the conformance suite requires a committed fixture and a loadable grammar for every `LANGUAGES` entry, so on-demand languages need either a separate catalog or a suite that can skip absent grammars.
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
