# Project Context — Hesman MCP

> Shared baseline for every working session (humans and AI agents). Descriptive facts only, no instructions.
> Last updated: 2026-10-13

## Name and purpose
Hesman is an MCP server that lets AI agents query a codebase (symbol lookup, call graph, impact analysis, semantic search) with minimal token usage. Runs fully locally; installed once via Node.

## Tech stack
Node ≥20, TypeScript (ESM), `@modelcontextprotocol/sdk` (stdio), web-tree-sitter (WASM), better-sqlite3 + FTS5, `@zvec/zvec` (vectors), `@xenova/transformers` (MiniLM, local), chokidar, pino, vitest.

## Current phase
**M0 — Fix the foundation: done (16/16 tasks).** Both blocking problem groups of v1.0 are fixed and covered by tests that run the real server:
1. Core: logs go to stderr only; languages are indexed through the worker pool from one language registry; the server exits when its client goes away; the call graph is correct across files; line numbers are 1-based everywhere.
2. Security: tool paths confined to the project root, safe vector-store filters, `find_pattern` ReDoS budget, symlinks skipped, guarded `clean`, clamped numeric arguments, verified parser downloads, atomic agent-config writes (see `docs/SECURITY.md`).

A real Claude Code smoke test passes 9/9. Verified on macOS only: the project has no CI, so Linux and Windows are unverified.

**M1, M3 and M4 are done; M2 is done except what needs an npm release** (per-task status: `tasks/STATUS.md`):
- **M1 — every programming language (10/10).** A generic symbol engine driven by Tree-sitter `tags.scm` queries; 16 bundled grammars with symbols and a call graph (TypeScript, TSX, JavaScript, Python, Go, Java, C, C++, C#, Rust, PHP, Ruby, Kotlin, Swift, Bash, Lua); seven more with symbols from grammars downloaded on demand (Scala, OCaml, F#, R, CodeQL, Arduino, Elixir); every other text file indexed as text. Calls and imports are read from the syntax tree and linked by visibility, imports and the declared type of the receiver. Agents are told which tier a language is in.
- **M2 — install once, works in every agent (5/7).** Non-blocking startup, automatic project detection (MCP roots → working directory), `hesman setup | remove` for eight clients, `hesman doctor`, opt-in agent usage rules. Open: the launch-command task needs manual checks, and one-click install links wait for an npm release.
- **M3 — dashboard (2/2).** `hesman ui`: a local page (127.0.0.1 + token) with logs, metrics, the index as a graph and a query playground.
- **M4 — token efficiency (1/1).** List and call-graph tools answer in a compact shape (named columns, rows grouped by file, project-relative paths); `get_context` returns a line range instead of a file.

Measured on this repository on 2026-10-13 with `node scripts/measure.mjs` (Apple M3 Pro; numbers and method in the README): `get_context` returns 80–96% fewer tokens than the whole file, callers/callees/references are 66–72% smaller than plain JSON, other lists 35–41%; every tool but `find_pattern` and `semantic_search` answers in under 1 ms; the index is ready in 2.4 s without semantic search and 70 s with it; the server rests at about 300 MB (545 MB with semantic search). A smoke test with the real Claude Code CLI passes 9/9.

The package is **not published on npm**; publishing is postponed by the owner. Verified on macOS only. The README is kept in English plus nine translations (`docs/i18n/`).

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
- Publish on npm (owner's decision), then finish M2-04 and M2-06.
- Call graph: type inference beyond one file; links across `extends` / `implements` in other files.
- Semantic search cost: the first index spends almost all its time computing embeddings on the CPU.
- Verify on Linux and Windows.
- Later: answer-quality eval suite; daemon + stdio-shim architecture; multi-project support; optional larger embedding model.
