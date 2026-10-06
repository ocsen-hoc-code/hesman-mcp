---
id: M0-03
title: Single language registry; index Python/Go
status: todo
priority: P0
depends_on: [M0-01]
updated: 2026-10-06
---

## Context

The language table is copied in **6 places**, and the copies have drifted:

| Location | Contents | Problem |
|---|---|---|
| `src/parsers/core.ts:11` `PROFILE_BY_LANG` | TS, Python, Go | — |
| `src/indexing/index-coordinator.ts:28` `PROFILE_BY_LANG` | TS, Python, Go | — |
| `src/indexing/worker.ts:43` `PROFILE_BY_LANG` | **TS only** | Python/Go fail with `Unsupported language` |
| `src/indexing/file-watcher.ts:14` `EXT_TO_LANG` | **TS/JS extensions only** | edits to `.py`/`.go` are never re-indexed |
| `src/indexing/project-scanner.ts:9` `EXTENSION_MAP` | TS, Python, Go | — |
| `src/server/tools/get-context.ts:74` `langMap` | missing `.mjs`, `.pyi`, … | wrong language label |

Reproduced on 2026-10-06 with the `py-basic` fixture: without the worker pool → 3 files, 12 symbols; **with the worker pool (the path the real server always takes) → 0 files**, error `Unsupported language: python`. Unit tests only cover the no-pool path, so they still pass.

## Scope

1. **Failing tests first:**
   - e2e (M0-01 harness, polyglot fixture): `find_symbol` in `exact` mode finds a Python symbol and a Go symbol.
   - Integration: `indexProject` **with a `WorkerPool`** indexes all three languages.
   - Integration: editing a `.py` file while the watcher runs updates its symbols.
2. Create `src/parsers/languages.ts` as the single source of truth:
   - `LANGUAGES: Array<{ id; extensions; profile }>`.
   - Design entries as **data** (id, extensions, grammar file, optional query files, optional override hook) so that M1 can add hundreds of languages by adding entries, not code. M0 still registers only TypeScript, Python and Go.
   - Derived helpers: `profileFor(id)`, `languageForPath(path)`, the list of valid ids (used by M0-05 for validation).
3. Replace all 6 locations above with imports from the registry; delete the copies.
4. Update *Adding a language* in `CLAUDE.md` and `docs/CONTRIBUTING.md`: a new language needs only a profile, one registry entry, the WASM file and tests.

## Out of scope

- Adding new languages.
- Moving relation extraction from regex to Tree-sitter queries.

## Acceptance criteria

- [ ] The 3 failing tests turn green.
- [ ] `grep -rnE "'\.(py|go|ts)'" src` only matches in `src/parsers/languages.ts` (and profile files).
- [ ] `CLAUDE.md` and `docs/CONTRIBUTING.md` describe the new process.

## Verification

```bash
npm test && npm run test:e2e
grep -rnE "'\.(py|go|ts)'" src
```

## Progress notes

- 2026-10-06: task created.
