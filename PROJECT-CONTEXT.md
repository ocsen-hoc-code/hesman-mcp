# Project Context — Hesman MCP

> Shared baseline for every working session (humans and AI agents). Descriptive facts only, no instructions.
> Last updated: 2026-10-06

## Name and purpose
Hesman is an MCP server that lets AI agents query a codebase (symbol lookup, call graph, impact analysis, semantic search) with minimal token usage. Runs fully locally; installed once via Node.

## Tech stack
Node ≥20, TypeScript (ESM), `@modelcontextprotocol/sdk` (stdio), web-tree-sitter (WASM), better-sqlite3 + FTS5, `@zvec/zvec` (vectors), `@xenova/transformers` (MiniLM, local), chokidar, pino, vitest.

## Current phase
**M0 — Fix the foundation.** v1.0 ships 11 tools but has two blocking problem groups:
1. Core is broken: logs go to stdout and corrupt the MCP stream; the real server only indexes TypeScript; tests never exercise the real server path.
2. Security holes: reads files outside the project, string-interpolated filters, ReDoS, symlink loops, unguarded `clean` deletion.

Per-task detail and status: `tasks/STATUS.md`.

## Key constraints
- No new features (multi-project, dashboard, daemon) until M0 is done.
- Every fix ships with a reproducing test (red first, then green).
- No external API calls at runtime; all data stays on the user's machine.
- Keep the tool count small and schemas compact (lesson from Serena's ~24k-token tool schema).
- All content written to repository files is in English.

## Definition of done (M0)
All M0 tasks are `done`; `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass; e2e runs the real server at the default log level against a TS + Python + Go fixture.

## Direction after M0 (not started)
- **M1 — Support every programming language.** Every text source file is indexed at some level, through three tiers: deep (symbols + call graph + imports), structural (symbols + references via tree-sitter `tags.scm` queries), text (full-text + semantic search). Each language's tier is reported to agents and in the README.
- **M2 — Install once, works in every agent.** `npx -y hesman-mcp setup` configures Claude Code, Claude Desktop, Codex, Cursor, Antigravity, VS Code, Gemini CLI and Windsurf with one global entry; the project is detected automatically (MCP roots → working directory); the server answers immediately and indexes in the background; `hesman doctor` diagnoses failures.
- Later: answer-quality eval suite; daemon + stdio-shim architecture; multi-project support; web dashboard (localhost + token).
