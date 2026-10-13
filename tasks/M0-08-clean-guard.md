---
id: M0-08
title: Guard rails for hesman clean
status: done
priority: P1
depends_on: []
updated: 2026-10-06
---

## Context

`src/cli/commands.ts:157-188` (`runClean`) runs `rmSync(dataDir, { recursive: true })` with `dataDir = resolve(projectRoot, config.dataDir)`.
`config.dataDir` comes from `hesman.config.json` (found by **walking up parent directories**) or the `HESMAN_DATA_DIR` env var. If the value is `..`, `.`, `~` or `/`, `hesman clean --force` recursively deletes that directory. The confirmation step only prints the path; it checks nothing.

## Scope

`runClean` refuses (prints the reason, exits with code 1) when:
1. `dataDir` equals `projectRoot`;
2. `dataDir` is an ancestor of `projectRoot`;
3. `dataDir` is the home directory or a filesystem root;
4. `dataDir` **does not contain `symbols.db`** — the marker created by `SqliteStore.open()` (`src/stores/sqlite.ts`), proving it really is a Hesman data directory.

`--force` does **not** bypass these checks. `--dry-run` reports the refusal reason too.

## Out of scope

- The `autoCleanDataDir` config field (backlog: dead-config cleanup).

## Acceptance criteria

- [x] `tests/unit/cli/clean-diag.test.ts` has one test per refusal condition plus one successful deletion of a valid directory.
- [x] Error messages name the violated condition.

## Verification

```bash
npx vitest run tests/unit/cli/clean-diag.test.ts
```

## Progress notes

- 2026-10-06: done. `runClean` now runs `cleanRefusalReason()` before any dry-run/prompt/delete; refusals print `Refusing to clean: <reason>.` to stderr and set exit code 1. Checks (in order): equals project root, filesystem root, home directory, ancestor of project root, missing `symbols.db`. Paths are compared after `realpath` (case-insensitive on win32). Deviation: an **empty** data directory is allowed without `symbols.db` (nothing to lose); this keeps the e2e test "hesman clean --force deletes .hesman" (which creates an empty `.hesman`) passing. Added 7 tests to `tests/unit/cli/clean-diag.test.ts` (5 refusal conditions incl. root via `--dry-run`, dry-run refusal reporting, valid deletion). Follow-up noticed, not fixed: `runClean` treats `args[0]` as the project path, so `hesman clean --force` without a path resolves the project root to `./--force`.
- 2026-10-06: task created.
