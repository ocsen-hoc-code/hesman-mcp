---
id: M2-05
title: `hesman doctor` — diagnose every client's setup end to end
status: todo
priority: P1
depends_on: [M2-03, M2-04]
updated: 2026-10-06
---

## Context

When an MCP server fails, clients usually show only "failed to start" or silently hide the tools. Users cannot tell whether the config is wrong, the command is not found, the server crashed, or it timed out. The existing `hesman diag` reports index internals, not client integration.

## Scope

For each detected client, `hesman doctor` checks and prints a pass/fail line with a concrete fix:
1. config file exists and parses; the `hesman` entry is present and matches the expected format;
2. the configured command resolves in the environment the client will use (see M2-04);
3. spawning the configured command completes the MCP `initialize` handshake within the client's typical startup timeout;
4. stdout carries only JSON-RPC (regression guard for M0-02);
5. project detection result (M2-02): which root would be indexed.

Flags: `--client <name>`, `--json` for machine-readable output (used by tests and by users filing bug reports).

## Out of scope

- Automatically fixing problems (print the fix command instead; `hesman setup` performs changes).

## Acceptance criteria

- [ ] Unit tests simulate each failure class (missing config, bad JSON, unresolvable command, crash on start, slow start, polluted stdout) and assert the reported cause.
- [ ] `--json` output is documented in `docs/TOOLS.md` or a new `docs/CLI.md`.

## Verification

```bash
npm test
node dist/index.js doctor
```

## Progress notes

- 2026-10-06: task created.
