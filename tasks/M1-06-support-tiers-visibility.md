---
id: M1-06
title: Expose support tiers to agents and users
status: pending
priority: P1
depends_on: [M1-04, M1-05]
updated: 2026-10-12
---

## Context

With hundreds of languages, support depth will vary. Three tiers:

| Tier | What works |
|---|---|
| **deep** | symbols + call graph + imports + impact analysis |
| **structural** | symbols, definitions and references (via `tags.scm`) |
| **text** | full-text, semantic search and context only |

Agents must know which tier applies, otherwise they trust an empty `get_callers` result for a language that simply has no call extraction. The README must not overstate support (v1.0 claimed "full support" for Python/Go while they indexed 0 files).

## Scope

1. `index_status` reports, per language: file count, tier, grammar source (bundled / downloaded / missing), and error count.
2. Graph tools (`get_callers`, `get_callees`, `impact_analysis`, `get_references`) include a note in the response when the symbol's language is below the tier the tool needs, instead of silently returning an empty list.
3. A script generates the README language matrix from the registry; CI fails if the README is out of sync.

## Out of scope

- Raising any language's tier (M1-07).

## Acceptance criteria

- [ ] `index_status` on the polyglot fixture shows one entry per language with its tier.
- [ ] `get_callers` on a structural-tier symbol returns an explicit "call graph not available for <lang>" note.
- [ ] The README language matrix is generated, and the CI check fails when it is stale.

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-12: started (branch `rebuild/m1-m2`). The project has no CI: the "CI fails" criterion is met by a unit test that fails when the README matrix is stale.

- 2026-10-06: task created.
