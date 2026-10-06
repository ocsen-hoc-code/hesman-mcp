---
id: M0-11
title: Write agent config safely (atomic + backup)
status: todo
priority: P2
depends_on: []
updated: 2026-10-06
---

## Context

`src/cli/install.ts:96` overwrites the agent's config file (`claude_desktop_config.json`, `~/.cursor/mcp.json`, `.vscode/mcp.json`) in place with `writeFileSync`. If the process is interrupted or the disk fills mid-write, the file can be corrupted and the agent loses **all** of its other MCP server entries. No backup is kept.

## Scope

1. Before the first modification, back up the existing file to `<config>.hesman.bak` (overwriting any older backup) and print the backup path.
2. Write atomically: write `<config>.tmp-<pid>` in the same directory, then `renameSync` over the original.
3. Idempotent: if the `hesman` entry is already identical → write nothing, report "already installed".
4. Preserve all other `mcpServers` entries (already correct — add a test that locks this in).

## Out of scope

- The `--global` flag and support for more clients (both handled in M2-03; the writer built here is reused there).

## Acceptance criteria

- [ ] `tests/unit/cli/install.test.ts` covers: backup created; other servers preserved; second run writes nothing; invalid JSON still errors and the file is **not** modified; no `.tmp-*` file left behind.

## Verification

```bash
npx vitest run tests/unit/cli/install.test.ts
```

## Progress notes

- 2026-10-06: task created.
