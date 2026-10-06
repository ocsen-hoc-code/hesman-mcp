---
id: M0-13
title: Correct call graph — no self-calls, cross-file calls, innermost caller
status: todo
priority: P0
depends_on: [M0-14]
updated: 2026-10-06
---

## Context

Found by the real-client smoke test (M0-12) and verified in the SQLite index of `polyglot-basic`:
- Every function has a `calls` relation **to itself at its own declaration line** (`GoGreet → GoGreet` at `go/greet.go:13`, `main → main`, …). `src/parsers/relation-extractor.ts:48` matches `\bname\s*\(` everywhere, including the declaration `func GoGreet(`.
- **Cross-file calls are missing:** `main → GoGreet` (`go/main.go:6`) is absent. Callees are looked up only in `nameMap`, built from the current file's symbols (`:40-45`), so a call to a function defined in another file never resolves.
- The caller is the **first** symbol whose range contains the line (`:59`), not the innermost one — a call inside a method can be attributed to its class.
- Consequence: `get_callers(GoGreet)` returned only GoGreet itself; `get_callees` and `impact_analysis` are wrong in the same way.

Symbol ids include the start line (`makeSymbolId(filePath, name, kind, row)`), so an id-based cross-file link breaks when the callee's file is edited and re-indexed. The design must survive incremental re-indexing.

## Scope

1. **Failing tests first:**
   - e2e on `polyglot-basic` (harness): `get_callers` of `GoGreet` contains `main` (go/main.go) and does not contain `GoGreet`; same shape for TypeScript (`tsGreet` ← `tsMain`, cross-file) and Python (`py_greet` ← `py_main`, cross-file).
   - `get_callees` of `GoGreet` contains `GoFormatName` and not `GoGreet`.
   - Integration: edit `go/greet.go` so `GoGreet` moves down several lines, re-index only that file (watcher or `indexProject`), then `get_callers(GoGreet)` still returns `main`.
   - Unit: a declaration line never produces a `calls` relation; a call inside a method is attributed to the method, not the class; recursion (`f` calling `f` in its body) is still recorded.
2. Exclude declaration sites (the match position is the symbol's own name in its declaration).
3. Attribute each call to the **innermost** enclosing symbol.
4. Resolve callees across files. Suggested approach (choose and justify): store the callee **name** with each call relation and resolve against the symbols table at query time (or in a post-index pass that is re-run for affected files on incremental updates). Resolution order: same file → files imported by the caller's file → unique project-wide match; ambiguous names must not fan out to every same-named symbol without a signal (document the rule).
5. Keep `get_callers` / `get_callees` / `impact_analysis` / `get_references` outputs and schemas compatible.
6. Relation `line` values are 1-based (M0-14 establishes the convention; build on it).

## Out of scope

- Moving extraction from regex to tree-sitter queries for all languages (M1-07), unless it is the simplest correct fix here.
- Method calls through objects (`obj.method()`) beyond what resolves by name today — document current behavior.

## Acceptance criteria

- [ ] All failing tests above turn green.
- [ ] On `polyglot-basic` the relations table contains no self-call at a declaration line.
- [ ] Incremental re-index of the callee's file keeps cross-file callers.
- [ ] Re-running the M0-12 smoke test step 5 passes (`get_callers(GoGreet)` returns `main`).

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-06: task created from the M0-12 smoke test findings.
