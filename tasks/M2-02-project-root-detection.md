---
id: M2-02
title: Detect the project automatically so one global entry works everywhere
status: todo
priority: P0
depends_on: [M0-12]
updated: 2026-10-06
---

## Context

`src/cli/install.ts:77-81` writes `cwd: projectRoot` into the agent's config — including **global** configs (Claude Desktop, Cursor). The server then indexes that one project no matter which workspace the user opens later, so "install once" does not hold. Each client starts servers differently: some use the workspace as the working directory, some expose workspace folders through the MCP **roots** capability, and Claude Desktop has no workspace at all.

## Scope

1. Resolve the project root in this order:
   1. explicit `--project-root` / `HESMAN_PROJECT_ROOT`;
   2. MCP `roots/list` from the client, when the client advertises the roots capability (and re-resolve on `notifications/roots/list_changed`);
   3. the process working directory, if it looks like a project (VCS directory or a known manifest file);
   4. otherwise: start with no project and have tools return a clear error explaining how to set one.
2. Verify per client (Claude Code, Claude Desktop, Codex, Cursor, Antigravity, VS Code, Gemini CLI, Windsurf) which of the mechanisms above actually applies, and record the result with the date in *Progress notes*.
3. Generated configs (M2-03) contain **no** `cwd` and no project path.
4. When roots list several folders, index the first one for now and log the others; full multi-root support belongs to the multi-project milestone.

## Out of scope

- Serving several projects from one process (multi-project milestone).

## Acceptance criteria

- [ ] e2e with a test client that advertises roots: the server indexes the root folder, not its working directory.
- [ ] e2e without roots, started inside a fixture directory: the server indexes that directory.
- [ ] Started from the home directory with no roots: no indexing of `~`; tools return the "no project" error.

## Verification

```bash
npm run test:e2e
```

## Progress notes

- 2026-10-06: task created.
