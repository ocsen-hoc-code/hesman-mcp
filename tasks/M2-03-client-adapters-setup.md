---
id: M2-03
title: Client adapters + `hesman setup` — one command configures every detected agent
status: done
priority: P0
depends_on: [M0-11, M2-02]
updated: 2026-10-11
---

## Context

`src/cli/install.ts` supports only `claude` (Desktop), `cursor` and `vscode`, and the VS Code output is **wrong**: it writes `mcpServers` into `.vscode/mcp.json`, while VS Code reads a `servers` key with `type: "stdio"`. Popular agents are missing entirely, and each uses a different file, format or CLI.

Formats researched on 2026-10-06 (each adapter must re-verify against official docs before release):

| Client | Where / how | Format |
|---|---|---|
| Claude Code | `claude mcp add --scope user …` (or project `.mcp.json`) | JSON `mcpServers` |
| Claude Desktop | `claude_desktop_config.json` (per-OS path, already implemented) | JSON `mcpServers` |
| OpenAI Codex | `codex mcp add hesman -- <command>` or `~/.codex/config.toml` | TOML `[mcp_servers.hesman]` |
| Cursor | `~/.cursor/mcp.json` (or project `.cursor/mcp.json`) | JSON `mcpServers` |
| Google Antigravity | `~/.gemini/config/mcp_config.json` (2.0+); older: `~/.gemini/antigravity/mcp_config.json` | JSON `mcpServers` |
| VS Code (Copilot) | `.vscode/mcp.json` or user-level `mcp.json` | JSON `servers` + `type: "stdio"` |
| Gemini CLI | `~/.gemini/settings.json` | JSON `mcpServers` (verify) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | JSON `mcpServers` (verify) |

## Scope

1. An adapter interface (`detect()`, `configPath()`, `read()`, `write(entry)`, `remove()`) with one adapter per client above, in `src/cli/clients/`.
2. **Prefer the client's own CLI** when it exists on PATH (`claude mcp add`, `codex mcp add`) — it absorbs future format changes; fall back to editing the file.
3. `hesman setup`:
   - detects installed clients and shows a checklist (all detected clients pre-selected);
   - flags: `--client <name…>`, `--all`, `--yes` (non-interactive), `--dry-run` (print exact changes), `--scope user|project` where supported;
   - writes through the atomic + backup writer from M0-11; idempotent; never touches other servers' entries;
   - TOML editing must preserve the user's comments and formatting (use a format-preserving TOML library or the Codex CLI).
4. `hesman remove [--client …]` reverses exactly what setup added.
5. Keep `hesman install --agent X` as an alias of `hesman setup --client X` for one minor version, then remove; drop the no-op `--global` flag.
6. Every adapter has golden-file unit tests (before/after config) on macOS, Linux and Windows paths.

## Out of scope

- Remote/HTTP transport configs (Hesman is local stdio).
- Clients not listed above (add later as adapters: OpenCode, Zed, Cline, Kiro, Copilot CLI, …).

## Acceptance criteria

- [x] The VS Code adapter writes `servers` + `type: "stdio"` (regression test for the current bug).
- [x] `hesman setup --dry-run --all` prints the exact change for each of the 8 clients.
- [x] Setup then remove leaves every config file byte-identical to the original (except for the backup file).
- [x] Each adapter's docs source and verification date are recorded in a comment at the top of the adapter.

## Verification

```bash
npm test
node dist/index.js setup --dry-run --all
```

## Progress notes

- 2026-10-11: merged into `rebuild/m1-m2` (commit `ddb4efd`); after the merge `npm test` passes 82 files / 883 tests + 1 skipped, and `node dist/index.js setup --dry-run --all` (real binary, real home, read-only) lists all 8 clients.
- 2026-10-11: done; closed by the commit that carries this note (`feat(cli): hesman setup / remove with adapters for 8 clients (M2-03)`).
  - **Code**: `src/cli/clients/` — `types.ts` (`ClientAdapter`: `detect()`, `configPath(scope)`, `read(scope)`, `write(entry, { scope, dryRun, projectRoot })`, `remove({ scope, dryRun })`; `ClientEnvironment` injects home, cwd, platform, env, `findOnPath`, `run`), `entry.ts` (`serverEntry()` — the one place that decides the launch command), `adapter.ts` (shared flow: compare → client CLI if on PATH → file through `writeConfigAtomically`), `json-codec.ts`, `toml-codec.ts` (text-block editor for `[mcp_servers.hesman]`, no TOML dependency), one file per client, `setup.ts` (`runSetup`, `runRemove`, `runInstall`). `src/cli/install.ts` is removed.
  - **Undo**: `remove` puts `<config>.hesman.bak` back when backup + the Hesman entry equals the file on disk (byte-identical for any original formatting), deletes a file that holds nothing but the Hesman entry (Hesman created it), and otherwise removes only the entry.
  - **Per-client result** (official docs accessed 2026-10-11; "unverified" = not stated in the docs read and not tested against the real client):

    | Client (`--client`) | User config | Project config | Format | How | Entry | Source |
    |---|---|---|---|---|---|---|
    | Claude Code (`claude-code`) | `~/.claude.json` (assumed `$CLAUDE_CONFIG_DIR/.claude.json` when set — unverified) | `.mcp.json` | JSON `mcpServers` | `claude mcp add --scope <scope> hesman -- <cmd>` / `claude mcp remove hesman --scope <scope>` when on PATH, else file | `{ type: "stdio", command, args }` | https://code.claude.com/docs/en/mcp |
    | Claude Desktop (`claude-desktop`) | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\…`, Linux `$XDG_CONFIG_HOME/Claude/…` (Linux path unverified) | — | JSON `mcpServers` | file | `{ command, args: [..., "--project-root", <cwd or --project-root>] }` | https://modelcontextprotocol.io/docs/develop/connect-local-servers |
    | Codex CLI (`codex`) | `$CODEX_HOME/config.toml`, default `~/.codex/config.toml` | `.codex/config.toml` (file only) | TOML `[mcp_servers.hesman]` | `codex mcp add hesman -- <cmd>` / `codex mcp remove hesman` (remove not found in the docs read — unverified; falls back to the file) when on PATH, else file | `command = "…"`, `args = […]` | https://learn.chatgpt.com/docs/extend/mcp?surface=cli, https://learn.chatgpt.com/docs/config-file/config-reference |
    | Cursor (`cursor`) | `~/.cursor/mcp.json` | `.cursor/mcp.json` | JSON `mcpServers` | file | `{ command, args: [..., "--project-root", "${workspaceFolder}"] }` (value of `${workspaceFolder}` in the global file unverified) | https://cursor.com/docs/context/mcp |
    | Antigravity (`antigravity`) | `~/.gemini/config/mcp_config.json`; legacy `~/.gemini/antigravity/mcp_config.json` used only if it alone exists (legacy path unverified) | `.agents/mcp_config.json` | JSON `mcpServers` | file | `{ command, args }` + printed note (project detection unverified) | https://antigravity.google/docs/mcp |
    | VS Code (`vscode`) | `mcp.json` in the default profile: macOS `~/Library/Application Support/Code/User/`, Windows `%APPDATA%\Code\User\`, Linux `$XDG_CONFIG_HOME/Code/User/` (on-disk path not in the docs — unverified) | `.vscode/mcp.json` | JSON `servers` | file | `{ type: "stdio", command, args }` | https://code.visualstudio.com/docs/copilot/reference/mcp-configuration |
    | Gemini CLI (`gemini-cli`) | `~/.gemini/settings.json` | `.gemini/settings.json` | JSON `mcpServers` | file (`gemini mcp add` has no `--` separator, not used) | `{ command, args }` | https://geminicli.com/docs/tools/mcp-server/ |
    | Windsurf (`windsurf`) | macOS/Linux `$XDG_CONFIG_HOME/devin/mcp_config.json` (default `~/.config/devin/`), Windows `%APPDATA%\devin\`; legacy `~/.codeium/windsurf/mcp_config.json` used only if it alone exists (legacy path unverified) | — | JSON `mcpServers` | file | `{ command, args }` + printed note (project detection unverified) | https://docs.devin.ai/desktop/cascade/mcp |
  - **Deviations / limits**: (1) the paths in the Context table above for Antigravity (project file), Windsurf and VS Code were corrected from the docs, see the table; (2) JSON files with comments or trailing commas are refused with an error and left untouched (no JSONC editing); (3) `--scope project` for Codex edits the file even when the CLI is present (the CLI has no project scope); (4) on Windows the client CLI is skipped when an argument would need shell quoting; (5) `hesman install --agent claude` keeps meaning Claude Desktop, while `hesman setup --client claude` is rejected as ambiguous; (6) `hesman install --agent vscode` now writes the user-level file (it is an alias of `setup --client vscode --yes`), not `.vscode/mcp.json`; (7) the `docs/i18n/README.*.md` translations still show `hesman install` (outside this task's files); (8) nothing was tested against a real client installation.
  - **Tests**: `tests/unit/cli/clients/` — `json-clients.test.ts`, `codex.test.ts`, `client-cli.test.ts`, `setup.test.ts`, `environment.test.ts`; `tests/unit/cli/install.test.ts` is replaced by the alias cases in `setup.test.ts`. `npm test`: 82 files, 883 passed + 1 skipped.
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
