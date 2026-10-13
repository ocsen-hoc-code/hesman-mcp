---
id: M2-05
title: `hesman doctor` — diagnose every client's setup end to end
status: done
priority: P1
depends_on: [M2-03, M2-04]
updated: 2026-10-11
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

- [x] Unit tests simulate each failure class (missing config, bad JSON, unresolvable command, crash on start, slow start, polluted stdout) and assert the reported cause.
- [x] `--json` output is documented in `docs/TOOLS.md` or a new `docs/CLI.md`.

## Verification

```bash
npm test
node dist/index.js doctor
```

## Progress notes

- 2026-10-11: merged into `rebuild/m1-m2` (commit `62245d8`). The main checkout now has `web-tree-sitter` 0.25.10 installed; `npm test` passes 99 files / 1206 tests + 1 skipped. The setup note for Antigravity/Windsurf now points at `hesman doctor` instead of calling it planned.
- 2026-10-11: done; closed by the commit that carries this note (`feat(cli): hesman doctor (M2-05)`).
  - **Code**: `src/cli/doctor/` — `doctor.ts` (`runDoctor(args, io, machine)`: options, the checks, text and JSON output), `types.ts` (`DoctorEnvironment`, `ProbeRequest`/`ProbeResult`, `DoctorReport`), `probe.ts` (real process: `initialize` without the `roots` capability, one `index_status` call, the "Opening project" stderr line), `environment.ts` (real machine). Wired in `src/cli/commands.ts` and `src/index.ts`. No adapter was changed: "config parses / entry present" comes from `client.remove({ dryRun: true })`, "entry is current" from `client.write(launchFor(client, 'auto', env).entry, { dryRun: true })`.
  - **Checks per client** (`config`, `entry`, `command`, `handshake`, `stdout`, `project`) and for the installation (`entry-script`, `node`, `parsers`); statuses, fixes and the `--json` shape are in `docs/CLI.md`.
  - **Decisions**: (1) a differing entry is a warning, not a failure — whether it works is decided by the command and handshake checks, and a hand-added `--project-root` (which setup's own notes recommend) counts as current; (2) a client that is only detected and not configured warns, one named with `--client` fails; (3) `NO_PROJECT` from doctor's directory warns, because a real client may send roots — except Claude Desktop without `--project-root`/`cwd`, which fails; (4) the probe appends `--no-semantic --no-watch` and sets `HESMAN_DATA_DIR` to a temp directory, so doctor writes nothing into the project and loads no model; (5) an `npx` entry asks the npm registry once (2 s limit): 404 fails, unreachable warns; (6) added `--timeout <ms>` (default 5000), not in the original scope, because a first `npx` start is slower than a local one.
  - **Not covered**: project-scope config files; the `env` of an entry; the PATH a desktop app really gets (warned about, not tested); the roots a real client sends (stated per client as "not verifiable", with the manual check for Cursor, Antigravity and Windsurf).
  - **Measured on this machine** (macOS, Node 24.5.0 through nvm, source checkout): `node dist/index.js doctor` exits 1 — Claude Desktop's entry is `hesman` with no args: `command` fails (`hesman` is not on PATH) and `project` fails (no `--project-root`); Claude Code, Antigravity and VS Code have a config without a `hesman` entry and Cursor has no `~/.cursor/mcp.json` (warnings). Handshake of this build through the doctor path in the e2e test: about 0.3 s per probe including shutdown.
  - **Follow-up outside this task's files**: `src/cli/clients/unverified.ts` still says "(`hesman doctor`, planned, will run this check.)"; it can now say "run `hesman doctor`".
  - Tests: `tests/unit/cli/doctor/doctor.test.ts` (48), `tests/e2e/doctor.test.ts` (8, real processes, offline).
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
