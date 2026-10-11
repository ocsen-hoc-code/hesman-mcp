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

- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
