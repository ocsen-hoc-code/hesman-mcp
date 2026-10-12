# Project Context — Hesman MCP

> Shared baseline for every working session (humans and AI agents). Descriptive facts only, no instructions.
> Last updated: 2026-10-12

## Name and purpose
Hesman is an MCP server that lets AI agents query a codebase (symbol lookup, call graph, impact analysis, semantic search) with minimal token usage. Runs fully locally; installed once via Node.

## Tech stack
Node ≥20, TypeScript (ESM), `@modelcontextprotocol/sdk` (stdio), web-tree-sitter (WASM), better-sqlite3 + FTS5, `@zvec/zvec` (vectors), `@xenova/transformers` (MiniLM, local), chokidar, pino, vitest.

## Current phase
**M0 — Fix the foundation: done (16/16 tasks).** Both blocking problem groups of v1.0 are fixed and covered by tests that run the real server:
1. Core: logs go to stderr only; languages are indexed through the worker pool from one language registry; the server exits when its client goes away; the call graph is correct across files; line numbers are 1-based everywhere.
2. Security: tool paths confined to the project root, safe vector-store filters, `find_pattern` ReDoS budget, symlinks skipped, guarded `clean`, clamped numeric arguments, verified parser downloads, atomic agent-config writes (see `docs/SECURITY.md`).

A real Claude Code smoke test passes 9/9. Verified on macOS only: the project has no CI, so Linux and Windows are unverified.

**M1, M2 and M3 are in progress on branch `rebuild/m1-m2`** (per-task status: `tasks/STATUS.md`):
- **M1 — every programming language.** Done: grammar ADR (`docs/adr/0001-grammar-distribution.md`), a generic symbol engine driven by Tree-sitter `tags.scm` queries, a language conformance suite, the text tier for files without a grammar, 16 bundled grammars (TypeScript, TSX, JavaScript, Python, Go, Java, C#, Rust, PHP, Kotlin, Swift, Lua, C, C++, Ruby, Bash), and the extraction fixes the conformance suite found. In progress: on-demand grammar delivery, query-based call extraction for more languages. Not started: exposing support tiers to agents.
- **M2 — install once, works in every agent.** Done: non-blocking startup, automatic project detection (MCP roots → working directory), `hesman setup | remove` for eight clients, `hesman doctor`, opt-in agent usage rules. Open: the launch-command task needs manual checks; one-click install links wait for an npm release.
- **M3 — dashboard.** In progress: `hesman ui` (local HTTP API with logs, metrics, index graph, query playground) and its frontend.

The package is **not published on npm**; publishing is postponed by the owner. Known gap: `_summary` does not reduce tokens yet; measured savings come from `get_context` pruning (~90% vs. the whole file for a ±5-line window).

## Key constraints
- M0 came first: no new feature was started until the foundation fixes were done.
- Not published on npm yet: docs must not present `npx -y hesman-mcp` as working.
- Every fix ships with a reproducing test (red first, then green).
- No external API calls at runtime; all data stays on the user's machine.
- Keep the tool count small and schemas compact (lesson from Serena's ~24k-token tool schema).
- All content written to repository files is in English.

## Definition of done (M0)
All M0 tasks are `done`; `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass; e2e runs the real server at the default log level against a TS + Python + Go fixture.

## Direction
- **M1 — Support every programming language.** Every text source file is indexed at some level, through three tiers: deep (symbols + call graph), structural (symbols only), text (full-text + semantic search). Each language's tier is reported to agents and in the README.
- **M2 — Install once, works in every agent.** `hesman setup` configures Claude Code, Claude Desktop, Codex, Cursor, Antigravity, VS Code, Gemini CLI and Windsurf with one global entry; the project is detected automatically; the server answers immediately and indexes in the background; `hesman doctor` diagnoses failures.
- **M3 — Dashboard.** `hesman ui` serves a local page (127.0.0.1 + token) to read logs and metrics, browse the index as a graph and try queries.
- Later: answer-quality eval suite; daemon + stdio-shim architecture; multi-project support; optional larger embedding model.
