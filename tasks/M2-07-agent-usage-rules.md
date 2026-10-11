---
id: M2-07
title: Opt-in agent usage rules (when to call Hesman instead of grep/read)
status: pending
priority: P2
depends_on: [M2-03]
updated: 2026-10-11
---

## Context

Installing an MCP server does not guarantee the agent uses it: agents often fall back to `grep` and full-file reads, which wastes exactly the tokens Hesman saves. Each agent reads a project instruction file: `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex and others), `GEMINI.md` (Gemini/Antigravity), `.cursor/rules/` (Cursor), `.github/copilot-instructions.md` (VS Code Copilot).

## Scope

1. A short, tested guidance block (≤ 15 lines) telling the agent which Hesman tool to use for which question (find a symbol, who calls X, what breaks if X changes, find code by meaning).
2. `hesman setup --rules` writes the block into the instruction file of each selected client, wrapped in clearly marked begin/end comments so `hesman remove` deletes exactly that block.
3. **Opt-in only**: never written without `--rules` or an explicit "yes" in the interactive prompt.
4. Measure the effect with the answer-quality eval (backlog) when it exists; until then, record a manual before/after comparison of tool usage on one task in *Progress notes*.

## Out of scope

- Per-language or per-project custom guidance.

## Acceptance criteria

- [ ] Setup with `--rules` then remove leaves each instruction file byte-identical to the original.
- [ ] Without `--rules`, no instruction file is touched (unit test).

## Verification

```bash
npm test
```

## Progress notes

- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
