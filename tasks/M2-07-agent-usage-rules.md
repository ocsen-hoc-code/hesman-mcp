---
id: M2-07
title: Opt-in agent usage rules (when to call Hesman instead of grep/read)
status: done
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

- [x] Setup with `--rules` then remove leaves each instruction file byte-identical to the original.
- [x] Without `--rules`, no instruction file is touched (unit test).

## Verification

```bash
npm test
```

## Progress notes

- 2026-10-11: merged into `rebuild/m1-m2` (commit `91b00e4`). Verified in a fresh clone: 0 type errors, lint 0 errors / 36 warnings, `npm test` 97 files / 1150 tests + 1 skipped. Scope item 4 (measuring the effect on real agent tool usage) remains unmeasured and is tracked in the backlog.
- 2026-10-11: done on branch `worktree-agent-a707beb57960e6c7f` (the commit that adds this note). Scope 1-3 implemented in `src/cli/rules/` and `src/cli/clients/setup.ts`: 14-line block (one constant, tested against the tools the server registers), `hesman setup --rules`, removal by `hesman remove`, interactive question with default No. Instruction files per client checked against the official docs on 2026-10-11 (URLs in `src/cli/rules/index.ts`); Windsurf uses the root `AGENTS.md`, Claude Desktop is skipped. Both acceptance criteria are covered by unit tests (`tests/unit/cli/rules/`, `tests/unit/cli/clients/setup.test.ts`); `npm test`: 92 files, 1068 passed, 1 skipped.
- 2026-10-11: **scope item 4 is NOT done.** No before/after comparison of real agent tool usage was run (it needs a live agent session with and without the block), so there is no evidence yet that the block changes agent behavior. The README and CHANGELOG say so. To do when the answer-quality eval exists, or by hand on one task.
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
