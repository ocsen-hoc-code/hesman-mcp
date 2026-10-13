---
id: M2-02
title: Detect the project automatically so one global entry works everywhere
status: done
priority: P0
depends_on: [M0-12]
updated: 2026-10-11
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

- [x] e2e with a test client that advertises roots: the server indexes the root folder, not its working directory.
- [x] e2e without roots, started inside a fixture directory: the server indexes that directory.
- [x] Started from the home directory with no roots: no indexing of `~`; tools return the "no project" error.

## Verification

```bash
npm run test:e2e
```

## Progress notes

- 2026-10-11: merged into `rebuild/m1-m2` (commit `dd2ab64`); after the merge `npm test` passes 78 files / 535 tests + 1 skipped.
- 2026-10-11: done; closed by the commit that carries this note (`feat(server): detect the project from MCP roots or the working directory (M2-02)`).
  - **Resolution** (`src/server/project-root.ts`, driven by `src/index.ts`): explicit root (`--project-root`, `HESMAN_PROJECT_ROOT`, or a `projectRoot` other than `.` in the config file) → first usable folder of the client's `roots/list` (asked on `notifications/initialized`, or on the client's first request if it never sends it; 5 s timeout, cancelled on shutdown; non-`file://` URIs, missing paths and files are skipped with a warning) → nearest directory at or above the working directory with a VCS directory or a manifest → no project. The home directory and its ancestors are never picked from roots or from the working directory. An explicit root ignores roots completely.
  - **Stores**: with an explicit root they open before `connect()` as before. Otherwise they open once the root is known; tools are registered up front against late-bound stand-ins (`src/server/late-bound.ts`) so `tools/list` is complete from the start. A guard in `McpServer` makes tool calls wait for the decision (or a switch in flight), then run or return `NO_PROJECT`. `indexState` is `resolving-root` (in progress) until then.
  - **Roots change**: `notifications/roots/list_changed` re-runs the detection (bursts collapse into one); if the first usable root differs, the initial index is aborted, the watcher stopped, the pool drained, the stores closed, and the new project opened and indexed. `.hesman` follows the root.
  - **Error text** (`NO_PROJECT`): "No project is selected, so there is nothing to search. Hesman picks the project from (1) --project-root or HESMAN_PROJECT_ROOT, (2) the workspace folders reported by the MCP client (roots), (3) its working directory when that is inside a project (a VCS directory or a manifest such as package.json, go.mod or pyproject.toml). None of these applied (working directory: <cwd>). To fix it, add "--project-root", "/absolute/path/to/project" to the args of the hesman entry in your MCP client configuration (or set HESMAN_PROJECT_ROOT in its env) and restart the server."
  - **Measured** (5 runs each, `polyglot-basic`, `--no-semantic --no-watch`): `initialize` + `tools/list` in 181–188 ms with an explicit root, 175–197 ms with client roots, 178–186 ms with no project; first tool answer 182–206 ms after spawn with client roots.
  - **Tests**: `tests/e2e/project-root.test.ts` (12 cases), `tests/unit/server/project-root.test.ts`, `tests/unit/server/late-bound.test.ts`, one case each in `index-state.test.ts` and `config-file.test.ts`. The e2e harness gained `explicitRoot`, `cwd`, `roots`, `tempDataDir` and `setRoots()`.
  - **Deviations / limits**: (1) acceptance case 2 uses a generated temp project, not a repository fixture: fixtures sit inside the Hesman checkout, so walking up from them finds the Hesman repo itself; (2) `detectProjectRoot` in `config/loader.ts` (returned the start directory when nothing matched) is removed, replaced by `findProjectRoot`; (3) new error code `NO_PROJECT` in `server/error-codes.ts`; (4) `--project-root` was documented but never parsed by the server — now it is; (5) scope item 3 (no `cwd` in generated configs) is left to M2-03, `src/cli/install.ts` is untouched; (6) `hesman.config.json` is still looked up from the working directory, not from a root learned through roots, so a project's config file is not applied when the server starts elsewhere; (7) an absolute `dataDir` (`HESMAN_DATA_DIR=/abs`) is shared by every project the process serves — after a root change the old project's rows stay in it; (8) a tool call already running when the root changes can fail with `INTERNAL_ERROR` because its store closes under it; (9) roots are not asked again when `roots/list` timed out, until the client sends `list_changed`.
  - **Per-client check** (official docs and client source, accessed 2026-10-11; "unverified" = no official statement found, not tested against the real client):

    | Client | Advertises MCP roots | Working directory of stdio servers | Mechanism that applies | Source |
    |---|---|---|---|---|
    | Claude Code (CLI) | Yes: launch directory plus `--add-dir` directories; `list_changed` since v2.1.203 | Not documented (unverified; docs tell servers not to depend on it). Also sets `CLAUDE_PROJECT_DIR` in the server's env | roots | https://code.claude.com/docs/en/mcp |
    | Claude Desktop | Unverified; a report against the desktop app says no roots are passed | Unverified; reports say the home directory or `/`, and that `cwd` in the config is ignored | none → `NO_PROJECT` unless `--project-root` is set | https://claudeissues.com/issue/75266-bug-claude-code-desktop-app-launches-mcp-servers-with-cwd-set-to-home-instead-of (community mirror of a GitHub issue, closed "not planned"; no official doc found) |
    | OpenAI Codex CLI | No: the initialize request carries only `elicitation` (and extensions) | `cwd` from `config.toml` if set, otherwise the caller's runtime working directory (`fallback_cwd`) | working directory | https://raw.githubusercontent.com/openai/codex/main/codex-rs/codex-mcp/src/rmcp_client.rs (`mcp_initialize_request_params`), https://raw.githubusercontent.com/openai/codex/main/codex-rs/rmcp-client/src/stdio_server_launcher.rs, https://learn.chatgpt.com/docs/extend/mcp?surface=cli |
    | Cursor | Docs list Roots as "Supported"; a 2025-04 forum report says `roots/list` answered "Method not found" (fix unverified) | Not documented (unverified). `${workspaceFolder}` is interpolated in `command`, `args`, `env` | roots if they answer; otherwise `--project-root ${workspaceFolder}` | https://cursor.com/docs/context/mcp, https://forum.cursor.com/t/mcp-client-does-not-support-roots-list/77248 |
    | Google Antigravity | Unverified (docs do not mention roots) | `cwd` field exists; default not documented (unverified) | unverified | https://antigravity.google/docs/mcp |
    | VS Code (Copilot) | Yes: "VS Code provides the MCP server with the user's workspace root folder information" | `cwd` "defaults to the workspace folder when run in a workspace" | roots, then working directory | https://code.visualstudio.com/api/extension-guides/ai/mcp, https://code.visualstudio.com/docs/copilot/reference/mcp-configuration |
    | Gemini CLI | Yes: `roots: { listChanged: true }`, answers with the workspace directories and notifies on change | `cwd` from settings if set; otherwise not passed to the SDK transport (inherits the CLI's directory — inferred from source, not documented) | roots | https://raw.githubusercontent.com/google-gemini/gemini-cli/main/packages/core/src/tools/mcp-client.ts, https://geminicli.com/docs/tools/mcp-server/ |
    | Windsurf | Unverified (docs do not mention roots) | Unverified (docs do not mention it); config supports only `${env:…}` / `${file:…}` interpolation, no workspace variable | unverified | https://docs.devin.ai/desktop/cascade/mcp (redirect target of docs.windsurf.com/windsurf/cascade/mcp) |
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
