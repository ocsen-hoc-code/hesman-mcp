---
id: M0-08
title: Guard rails for hesman clean
status: todo
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

- [ ] `tests/unit/cli/clean-diag.test.ts` has one test per refusal condition plus one successful deletion of a valid directory.
- [ ] Error messages name the violated condition.

## Verification

```bash
npx vitest run tests/unit/cli/clean-diag.test.ts
```

## Progress notes

- 2026-10-06: task created.
