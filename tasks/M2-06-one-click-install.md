---
id: M2-06
title: One-click install links and ecosystem installers
status: todo
priority: P2
depends_on: [M2-04]
updated: 2026-10-06
---

## Context

Many users install MCP servers by clicking a button in a README or a directory listing rather than running a command. Supported mechanisms (researched 2026-10-06):
- Cursor deeplink: `cursor://anysphere.cursor-deeplink/mcp/install?name=<NAME>&config=<BASE64_JSON>`.
- VS Code install links (`vscode:mcp/install?...`) — verify the current format in the VS Code MCP docs.
- `add-mcp` (Neon) installs an MCP server into 10+ detected agents with `npx add-mcp <package>`.

## Scope

1. A script that generates the Cursor and VS Code install links from the same entry `hesman setup` writes (M2-04 default command), so links never drift from the CLI.
2. README "Install" section: the CLI one-liner first, then "Add to Cursor" / "Add to VS Code" buttons, then a collapsible manual-config section per client generated from the adapters (M2-03).
3. Verify `npx add-mcp hesman-mcp` produces a working setup for at least Claude Code, Codex and Cursor; document it as an alternative.
4. Evaluate listing Hesman in the official MCP registry and major MCP directories; record the decision in *Progress notes*.

## Out of scope

- Building a GUI installer.

## Acceptance criteria

- [ ] Both install links work on a clean machine (manual check, recorded in *Progress notes*).
- [ ] A CI check fails if the README links or manual snippets differ from what the generator produces.

## Verification

```bash
npm test
```

## Progress notes

- 2026-10-06: task created.
