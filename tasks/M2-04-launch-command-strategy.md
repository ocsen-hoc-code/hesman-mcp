---
id: M2-04
title: Launch command that works in GUI apps and survives Node upgrades
status: todo
priority: P1
depends_on: [M2-03]
updated: 2026-10-06
---

## Context

`src/cli/install.ts:78` writes `command: 'hesman'`. That only works if Hesman is installed globally **and** on the PATH the client sees. GUI apps (Claude Desktop, Cursor, Antigravity launched from the Dock) often do not inherit the shell PATH, so `hesman`, `node` or `npx` installed through nvm/fnm/volta are not found. Absolute paths fix that but break when the user switches Node versions.

## Scope

1. Default command: `npx -y hesman-mcp@<major>` — works without a global install and keeps working across Node upgrades.
2. At setup time, check whether the client will be able to resolve `npx` (GUI apps on macOS: test with a minimal environment, not the user's shell PATH). If not, write absolute paths (`process.execPath` + the installed entry script) and print a warning that re-running `hesman setup` is needed after a Node upgrade.
3. Flag `--command npx|global|absolute` to override the choice.
4. Measure cold-start time of the `npx` path; if the npm registry check makes startup slow, document the trade-off and consider the cached-package flag `npx` offers.
5. README: one short "Quick start" that is exactly `npx -y hesman-mcp setup`.

## Out of scope

- Single-binary packaging (`pkg`/`nexe`/Node SEA) — evaluate later; native modules (`better-sqlite3`) make it non-trivial.

## Acceptance criteria

- [ ] On a macOS machine with Node installed via nvm, Claude Desktop starts Hesman successfully after `hesman setup`.
- [ ] After switching Node major version with nvm, the `npx` configuration still starts.
- [ ] `--command` overrides are covered by unit tests.

## Verification

Manual checks above, recorded in *Progress notes*; `npm test` for the unit tests.

## Progress notes

- 2026-10-06: task created.
