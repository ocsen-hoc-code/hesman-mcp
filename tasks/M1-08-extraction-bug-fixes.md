---
id: M1-08
title: Fix the extraction bugs found by the conformance suite
status: pending
priority: P0
depends_on: [M1-03]
updated: 2026-10-11
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

- [ ] Every `knownGaps` entry that this task covers is removed and the conformance suite is green.
- [ ] Unit tests cover each of the six items, including a negative case (what must not be exported / not be a call).
- [ ] Golden differences are listed and justified; the call-graph e2e and integration tests still pass.
- [ ] A real-world parity run on Hesman's own `src/` reports how many exported flags, calls and signatures changed, with a sample of each.

## Verification

```bash
npm test && npm run test:conformance
```

## Progress notes

- 2026-10-11: task created and started (branch `rebuild/m1-m2`).
