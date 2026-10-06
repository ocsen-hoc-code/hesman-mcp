---
id: M1-03
title: Language conformance test suite
status: todo
priority: P0
depends_on: [M1-02]
updated: 2026-10-06
---

## Context

Once languages are added as data rather than code, the only way to know a language actually works is a test that exercises every registry entry. Without it, a broken grammar or query fails silently — the same failure mode as Python/Go indexing 0 files in v1.0.

## Scope

1. Fixture layout: `tests/fixtures/languages/<lang>/` with at least one small, realistic source file per registered language.
2. One parameterized test that iterates over the registry and, for each language, asserts:
   - the grammar loads;
   - the fixture parses with `ERROR` nodes below a small threshold;
   - at least one symbol is extracted (structural and deep tiers);
   - at least one call relation is extracted (deep tier only).
3. A check that fails CI when a registry entry has no fixture.
4. Output a per-language pass/fail table in the test report so regressions are easy to spot.

## Out of scope

- Answer-quality evaluation (backlog).

## Acceptance criteria

- [ ] The suite covers every language in the registry.
- [ ] Removing a fixture or breaking a query makes CI fail with the language named.

## Verification

```bash
npx vitest run tests/conformance/
```

## Progress notes

- 2026-10-06: task created.
