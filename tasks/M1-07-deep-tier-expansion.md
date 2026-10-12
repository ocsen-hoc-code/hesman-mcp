---
id: M1-07
title: Expand the deep tier (call graph + imports) to the most-used languages
status: done
priority: P2
depends_on: [M1-02, M1-03]
updated: 2026-10-12
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

- [x] Every language listed above is in the deep tier and passes conformance.
- [x] `relation-extractor.ts` gains no new regex rules.

## Verification

```bash
npx vitest run tests/conformance/
```

## Progress notes

- 2026-10-12: done (branch `worktree-agent-a2dfdd6f05db8ec78`, commits `137f91c`, `9c3c8af`, `c174227`, then merged with `rebuild/m1-m2` in `a362331`). Done as one task instead of one sub-task per language (scope item 4), because the work turned out to be one generic mechanism plus one small query file per language.
  - **Design.** Calls and imports are `@reference.call` (`@reference.send`) / `@reference.import` matches of the language's query layers, run by `TagsQuery.analyze` in the same tree walk as the definitions. The regex call and import rules are removed from `relation-extractor.ts` (`extends` / `implements` keep their existing regexes); `ParseResult.references` replaces `ParseResult.ignoredRanges`. Upstream calls only: go, python, kotlin, lua. Upstream + `hesman-relations.scm`: typescript, tsx, javascript, java, csharp, php, rust, ruby. Hesman only (upstream tags no reference): c, cpp, swift, bash. A pattern with a property predicate (upstream Ruby's `#is-not? local`) is skipped, since the runtime does not evaluate it.
  - **Tiers.** All 16 bundled languages are `deep`; c, cpp, ruby and bash moved from `structural`, each proven by its conformance fixture (`calls[]` added from the sources; C got a second source file that calls across files).
  - **Declaration rule** (C/C++ prototypes, interface/abstract/protocol methods): a function or method without a body is stored with `is_declaration = 1` and is not a call target when a same-named one with a body exists, so the call links to the implementation; with no definition in the project the declaration stays the target; several implementations stay unresolved (no fan-out). Rust trait signatures, Go interface methods and TypeScript signatures are not symbols at all, which gives the same result.
  - **Constructor rule:** when a class named `X` exists, a same-named function or method of the same language is its constructor and not a separate target, so `new X(...)` links to the class (Java, C#, C++).
  - **Imports** from the tree: TypeScript/TSX/JavaScript (also `import './x'`, `export ... from`, `require()`, `import()`), Python, Go, C/C++ (`#include "..."`), Ruby (`require`, `require_relative`). `importedFiles` maps them to project files per language (Go through the nearest `go.mod`). No import relations yet: java, csharp, kotlin, swift, php, rust, lua, bash.
  - **Recorded limits fixed:** Java/C# `new X(...)` with a declared constructor; interface method vs implementation (Java, C#, Kotlin, Swift, PHP); false calls from `foreach (`, `when (`, Lua `function(`, anonymous `function (...)` and Go `func(...)`; imports only for ES. **Remaining:** coarse upstream kinds; a method called on an interface with several implementations; a Ruby call without receiver, arguments or parentheses; a C++ constructor call written as a declaration (`Item local(3);`); Python `super().__init__()` links `__init__` to itself when the file has one `__init__` (as before).
  - **Parity on `src/` at f6a32ce (85 TypeScript files, 2,067 symbols):** 3,125 → 3,131 calls: 3,085 kept, 40 removed (`async (` 20, `import(` 16, `super(` 3, `as (` 1), 46 added (`new Map<..>()` and other generic `new` 35, `.catch(` 3, optional calls `x?.()` and the like 8); linked 1,420 → 1,426, none lost, none retargeted. Imports 397 → 412.
  - **Performance:** `parse + sqlite upsert (1 file)`, interleaved runs on one machine: 4,031–4,126 files/s before, 4,127–4,142 after.
  - Index schema version 6 → 7.
- 2026-10-12: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
