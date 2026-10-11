---
id: M2-04
title: Launch command that works in GUI apps and survives Node upgrades
status: pending
priority: P1
depends_on: [M2-03]
updated: 2026-10-11
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
- [x] `--command` overrides are covered by unit tests.

## Verification

Manual checks above, recorded in *Progress notes*; `npm test` for the unit tests.

## Progress notes

- 2026-10-11: implemented; status stays `pending` because three things need the owner (see "Left for the owner").
  - **Fact that changed the spec:** `hesman-mcp` is not on npm (`npm view hesman-mcp` → 404, checked by the coordinator), so `npx -y hesman-mcp@<major>` cannot be the unconditional default (scope 1) and the README quick start cannot be `npx -y hesman-mcp setup` (scope 5). Publishing is the owner's decision and not part of this task.
  - **Implemented:** `hesman setup --command auto|npx|global|absolute` (default `auto`), built in `src/cli/clients/entry.ts`. `auto`, from local facts only: runs from an `_npx` cache directory → `npx`; `hesman` on PATH resolves (realpath) to this installation → `global` (Windows: the shim sits next to the `node_modules/hesman-mcp` holding it); otherwise → `absolute` (`process.execPath` + `<package>/dist/index.js`).
  - **Desktop apps** (claude-desktop, cursor, antigravity, vscode, windsurf; `kind: 'gui'` on the adapter): on macOS/Linux, when `auto` picked `npx`/`hesman` and the first such command on PATH or the first `node` on PATH is outside `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin` (+ `/opt/homebrew/bin` on macOS, `/snap/bin` on Linux), that client gets `absolute` plus a note to re-run `hesman setup` after switching Node versions. On Windows "on PATH" is enough. Terminal clients keep the chosen command. An explicit `--command` is never replaced, only warned about, so `npx` can still be forced for a desktop app.
  - **`--command npx` while not started through npx:** no network call; prints that `npx` only works once `hesman-mcp@<major>` is published.
  - **Cursor** (risk from M2-03): user scope now writes the plain entry, project scope keeps `--project-root ${workspaceFolder}`.
  - **Measured on this machine** (macOS, Node v24.5.0 through nvm, source checkout, `hesman` not on PATH), `node dist/index.js setup --dry-run --client claude-code` and `--client claude-desktop`: both print `chosen by --command auto: \`hesman\` is not on PATH` and the entry `~/.nvm/versions/node/v24.5.0/bin/node <checkout>/dist/index.js` (Claude Code through `claude mcp add --scope user hesman -- …`; Claude Desktop with `--project-root <cwd>` appended). With `--command npx`, Claude Desktop and Cursor keep `npx -y hesman-mcp@1` and get the "may not find `npx`: it is at ~/.nvm/…/bin/npx" warning; Gemini CLI gets no warning.
  - **Left for the owner:** (1) acceptance box 1 — start Claude Desktop after `hesman setup` on an nvm machine (not run: an agent cannot drive the app); (2) acceptance box 2 — needs the package published, then `--command npx` and an nvm major switch; (3) scope 4, cold-start time of the `npx` path — cannot be measured before publishing.
  - Tests: `tests/unit/cli/clients/launch.test.ts` (new), `--command` cases in `setup.test.ts`, Cursor and client-kind cases in `json-clients.test.ts`, `installation`/`realpath` in `environment.test.ts`.
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
