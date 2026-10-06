---
id: M0-04
title: Confine paths to the project root
status: todo
priority: P0
depends_on: [M0-01]
updated: 2026-10-06
---

## Context

- `src/server/tools/get-context.ts:30-34` calls `existsSync` then `readFileSync` on **any path** the agent passes — it can read `~/.ssh/id_rsa`, `~/.aws/credentials`, or another project's `.env`.
- No size limit and no file-type check: `/dev/zero` can hang the server or exhaust memory.
- Tool input must be treated as untrusted: an agent can be prompt-injected by the very code or docs it reads.
- `get_file_structure`, `list_dependencies` and `find_symbol` (`filePath` argument) only query the DB, but they take unnormalized paths, so relative paths never match (the DB stores absolute paths).

## Scope

1. **Failing test first:** e2e calls `get_context` on `/etc/hosts` (Windows: `C:\Windows\win.ini`) — it currently returns the content; it must return `isError`.
2. Create `src/server/paths.ts` with a function like `resolveProjectPath(projectRoot, input)`:
   - Relative paths resolve against `projectRoot`.
   - Compare `realpath` of both sides (blocks symlinks pointing outside); use `path.relative` and reject results that start with `..` or are absolute.
   - For reads: must be a regular file with `size ≤ config.maxFileSizeBytes`.
3. Apply it **mandatorily** in `get_context`.
4. Normalize `filePath` (no disk read) in `get_file_structure`, `list_dependencies` and `find_symbol` so relative paths work.
5. `registerAllTools` (`src/server/tools/index.ts:17`): make `config` required so every tool knows `projectRoot`.
6. Add a `PATH_OUTSIDE_PROJECT` code to `src/server/error-codes.ts` (or use `INVALID_INPUT` with a clear message).

## Out of scope

- Per-project access control (belongs to the multi-project design after M0).

## Acceptance criteria

- [ ] Unit tests for the helper, one per case: `../../etc/passwd`, `/etc/hosts`, an in-root symlink pointing outside, `/dev/zero`, a directory, an oversized file, a valid relative path, a valid absolute path.
- [ ] The e2e test from step 1 turns green.
- [ ] `get_file_structure` accepts relative paths.
- [ ] No `readFileSync` in `src/server/tools/` receives a path that bypassed the helper.

## Verification

```bash
npm test && npm run test:e2e
grep -rn "readFileSync" src/server/tools
```

## Progress notes

- 2026-10-06: task created.
