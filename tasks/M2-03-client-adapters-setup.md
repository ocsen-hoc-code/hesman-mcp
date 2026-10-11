---
id: M2-03
title: Client adapters + `hesman setup` — one command configures every detected agent
status: pending
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

- [ ] The VS Code adapter writes `servers` + `type: "stdio"` (regression test for the current bug).
- [ ] `hesman setup --dry-run --all` prints the exact change for each of the 8 clients.
- [ ] Setup then remove leaves every config file byte-identical to the original (except for the backup file).
- [ ] Each adapter's docs source and verification date are recorded in a comment at the top of the adapter.

## Verification

```bash
npm test
node dist/index.js setup --dry-run --all
```

## Progress notes

- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
