---
id: M1-08
title: Fix the extraction bugs found by the conformance suite
status: done
priority: P0
depends_on: [M1-03]
updated: 2026-10-12
---

## Context

The conformance suite (M1-03) and the engine migration (M1-02) exposed real extraction bugs, recorded as `knownGaps` in `tests/fixtures/languages/*/expected.json` or in task notes. The owner asked on 2026-10-11 to fix them before starting the dashboard (M3).

## Scope

Each fix starts with a failing test (the `knownGaps` entry is removed, so the conformance suite goes red first).

1. **Wrong `isExported` in TypeScript/JavaScript** (`isNodeExported` in `src/parsers/core.ts`): a declaration local to an exported function is reported as exported (`addArea` in `shapes.ts`, `increment` in `view.jsx`); a `private` / `#private` member of an exported class is reported as exported (`describe`). Only top-level exported declarations and the public members of exported classes are exported.
2. **CommonJS exports:** names listed in `module.exports = { a, b }`, `module.exports.a = …` and `exports.a = …` are exported (`backoff`, `Retrier`, `createRetrier` in `legacy.js`).
3. **Python tuple assignment:** `LOW_STOCK, HIGH_STOCK = 5, 50` at module level indexes both names (a `queries/python/hesman-tags.scm` layer, recorded in `queries/SOURCES.json` and `NOTICE`).
4. **False calls from the regex call extractor** (`src/parsers/relation-extractor.ts`): no call from text inside string literals or comments (`label -> s` from `"%s ("`), and no call from a declaration that is not a call (an interface method specification such as `Stocker -> Restock`, an abstract/overload signature such as `Shape -> area`). Use the syntax tree to skip string/comment ranges and non-call declaration sites rather than more regex special cases.
5. **Multi-line signatures:** a definition whose parameter list spans lines gets its full parameter list in `signature` (today a multi-line TypeScript constructor yields `constructor(`), still length-capped.
6. **Call resolution to property-assigned functions (from M1-02):** functions assigned to object keys or properties (`{ onClick: () => … }`, `obj.h = function …`) must not be picked by the resolver's whole-project tier just because the name is unique; they may still be linked in the same-file tier.

Bump `INDEX_SCHEMA_VERSION` by exactly +1 (stored symbols and relations change) and update the golden files, listing every intended difference.

## Out of scope

- JSX/TSX parse errors (fixed by the separate `tsx` / `javascript` grammars in M1-05).
- Moving call extraction to tree-sitter queries for all languages (M1-07).
- Local variables inside function bodies being indexed as symbols (owner decision pending).

## Acceptance criteria

- [x] Every `knownGaps` entry that this task covers is removed and the conformance suite is green.
- [x] Unit tests cover each of the six items, including a negative case (what must not be exported / not be a call).
- [x] Golden differences are listed and justified; the call-graph e2e and integration tests still pass.
- [x] A real-world parity run on Hesman's own `src/` reports how many exported flags, calls and signatures changed, with a sample of each.

## Verification

```bash
npm test && npm run test:conformance
```

## Progress notes

- 2026-10-12: merged into `rebuild/m1-m2` (merge of `271b2ed`); `npm test` passes 103 files / 1583 tests + 1 skipped in the main checkout; `INDEX_SCHEMA_VERSION` is 6.
- 2026-10-12: done on branch `worktree-agent-ab2c4eb4a46a7d967` (commit `18ced69`, merge of `rebuild/m1-m2` with M1-05a in `df41544`, and the commit that adds this note). Not merged into `rebuild/m1-m2` yet.
  - **1. `isExported`:** `isEcmaScriptExported` in the new `src/parsers/ecmascript.ts` replaces `isNodeExported` and is the default of `parseFile` for a profile without an `isExported` hook, so `typescript`, `tsx` and `javascript` share it. It looks at the parent of the definition instead of any ancestor: exported are a top-level declaration that is exported (on the declaration, in an export list, by `export default name`, by CommonJS), an `export` inside an exported namespace, and a public member of an exported class. `private`, `protected` and `#private` members are not exported (the spec says "public members"), and neither is a function that is only a key of an exported object.
  - **2. CommonJS:** the same helper collects, once per syntax tree, the names a file exports by reference: `module.exports = name`, `module.exports = { a, key: b }`, `module.exports.x = name`, `exports.x = name`, plus `export { a, b as c }` and `export default name` (not `export { a } from`). `exports.x = function ...` and a function-valued key of `module.exports = { ... }` are exported definitions themselves. Only top-level statements count.
  - **3. Python tuple assignment:** `queries/python/hesman-tags.scm` (listed after upstream in the registry, recorded in `queries/SOURCES.json` and `NOTICE`) tags every plain name of a module-level `pattern_list` / `tuple_pattern` assignment as a constant.
  - **4. False calls:** `parseFile` looks up, while the tree is alive, the innermost node at every place the call regex matches (`callSiteOffsets` in `relation-extractor.ts`, `ignoredRangesAt` in `tags-engine.ts`) and returns the ranges of the ones that are text (node type contains `comment`, `string`, `str_text`, `heredoc`, `regex`, `jsx_text`, `escape_sequence`) or whose parent is a signature-only declaration (type contains `signature`, or is `method_elem` / `method_spec`) as `ParseResult.ignoredRanges`. `extractRelations` takes them as an optional fifth argument and skips matches inside; the worker and the coordinator's single-threaded path pass them on. Type names are matched by pattern, not per language, and an unknown grammar is simply not filtered. Code inside an interpolation is an identifier node and still counts. Recursion and the M0-13 declaration rule are unchanged (tested). A first version collected every string and comment with a query and cost +19% on this repository's `src/`; looking up only the regex matches costs +3–7%.
  - **5. Signatures:** `signatureOf` includes a parameter list (the `parameters` field of the definition or of the function it binds) that starts on the first line and ends on a later one, joined into one line without the comments between parameters, up to the end of the line it closes on and never into the body; still capped at 200 characters. A multi-line value that is not a parameter list (`const x = build(\n...`) keeps its first line.
  - **6. Property-assigned functions:** new column `symbols.is_property` (added by `ALTER TABLE` for older databases; 1 for a `function` whose definition node is an object `pair` or an assignment to a member expression). It is stored with the symbol, so it survives incremental re-indexing. `getCallTargetCandidates` marks a candidate `same_file_only` when `is_property = 1 AND is_exported = 0`; `pickCallTarget` counts such a candidate in the same-file tier only (so it also no longer makes a real target ambiguous). A property function exported through CommonJS stays a normal target. No tool reads the column; tool outputs are unchanged.
  - **Schema:** `INDEX_SCHEMA_VERSION` 5 → 6 (M1-05 took 5).
  - **Known gaps removed:** `typescript/expected.json`: `describe@45`, `addArea@53`; `javascript/expected.json`: `increment@11`, `backoff@9`, `Retrier@14`, `createRetrier@37`; `python/expected.json`: `LOW_STOCK@7`, `HIGH_STOCK@7` (and `symbolCount.min` 12 → 14). Expectation changed from the source: `constructor@15` and `run@20` in `javascript/legacy.js` are `isExported: true`, because `Retrier` is exported by `module.exports` and they are its public members.
  - **Golden differences** (`EXPECTED_DIFFERENCES` in `golden-symbols.test.ts`; the golden JSON files are untouched): `ts-basic`, `src/index.ts`: `result` (line 9) and `calc` (line 10) are `isExported` 0, were 1 — local variables of the exported function `main`. No other difference in the four fixtures. One assertion in `tags-migration.test.ts` changed: the three-line Python `def greet(\n self,\n):` has the signature `def greet(self)`, was `def greet(`.
  - **Parity run** on this repository's `src/` at `c869b2a` (90 files), old extractor against new: 1,954 symbols before and after, none added or removed. *Exported flag:* 847 symbols 1 → 0 (741 variables, 76 functions, 30 methods), 1 symbol 0 → 1. Checked in the source: `cli/args.ts:21` `const result` inside `splitArgs`; `indexing/file-watcher.ts:111` `private async handleChange`; `cli/clients/claude-code.ts:38` `add: (entry, scope) => [...]` (object key); `parsers/text-chunker.ts:53` `const flush = (): void =>` (nested); `config/loader.ts:51` `parseCliFlagsToOverrides` 0 → 1 (`export { parseCliFlagsToOverrides };` on line 111). *Calls:* 3,336 → 3,028, 308 removed, none added: about 123 in comments (`index.ts:369` `// Tool calls wait for the decision (and ...` gave `main -> decision`), about 26 one-line interface members (`cli/clients/codec.ts:12` `read(text: string | undefined, path: string): ServerEntry | undefined;` gave `ConfigCodec -> read`), the rest in strings and multi-line signatures (`stores/sqlite.ts:403` `COUNT(DISTINCT file_path)` in SQL gave `getLanguageStats -> COUNT`; `cli/commands.ts:79` help text gave `printHelp -> clients`). *Signatures:* 38 changed, all multi-line parameter lists, e.g. `async function indexProject(` → `async function indexProject(rootDir: string, store: SqliteStore, config: HesmanConfig, zvecStore?: ZVecStore, pool?: WorkerPool, options: IndexOptions = {}): Promise<IndexResult>`; `function projectCheck(` → the full list without the two doc comments between its parameters. 43 functions are flagged `is_property`.
  - **Perf:** `parse + sqlite upsert (1 file)`: 4,208 files/s on `rebuild/m1-m2` (`afb28c1`) → 4,088 files/s (−2.8%). Extracting `src/` (parse + relations, median of 20 runs): 84.0 → 89.1 ms before the merge (+6%), 93.3 → 95.9 ms after it (+3%).
  - **Verification** (after the merge): `npm run typecheck` clean; `npm run lint` 0 errors / 36 warnings; `npm test` 103 files, 1,583 passed + 1 skipped, twice (baseline 101 / 1,541 + 1: +49 new tests, −7 known-gap test cases); `npm run test:conformance` 2 files, 232 passed, all 16 languages `ok`, the only known gaps left are the Rust and Kotlin doc-comment ones from M1-05.
  - **Not done here:** by reading `CALL_KEYWORDS`, the regex still accepts keywords that are not in that list as callees (an anonymous `function (...)`, a Go `func(...)` literal); not measured here, and fixing it properly needs call extraction from the tree (M1-07). `docs/ARCHITECTURE.md` does not mention the `is_property` column yet.
- 2026-10-11: task created and started (branch `rebuild/m1-m2`).
