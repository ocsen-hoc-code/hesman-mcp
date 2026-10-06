# Task Status

Updated: 2026-10-06 · **M0: 3/12 done** · **M1: 0/7 done** · **M2: 0/7 done**

Status conventions and update rules: see [`README.md`](README.md).

## M0 — Fix the foundation (before any new feature)

Goal: resolve the two blocking problems — **(1) broken core** and **(2) security holes** — with tests that run through the real server.

| # | Task | Area | Priority | Depends on | Status |
|---|---|---|---|---|---|
| M0-01 | [Real-server e2e harness + polyglot fixture](M0-01-e2e-harness.md) | Test | P0 | — | todo |
| M0-02 | [Log to stderr through one shared logger](M0-02-logger-stderr.md) | Core | P0 | M0-01 | todo |
| M0-03 | [Single language registry; index Python/Go](M0-03-language-registry.md) | Core | P0 | M0-01 | todo |
| M0-04 | [Confine paths to the project root](M0-04-path-containment.md) | Security | P0 | M0-01 | todo |
| M0-05 | [Safe ZVec filters; validate kind/language](M0-05-zvec-filter.md) | Security | P1 | M0-03 | todo |
| M0-06 | [Prevent ReDoS and event-loop blocking in find_pattern](M0-06-find-pattern-hardening.md) | Security | P1 | M0-01 | todo |
| M0-07 | [Scanner and watcher ignore symlinks](M0-07-symlink-safety.md) | Security | P1 | M0-03 | todo |
| M0-08 | [Guard rails for `hesman clean`](M0-08-clean-guard.md) | Security | P1 | — | todo |
| M0-09 | [Validate and clamp numeric tool arguments](M0-09-numeric-args.md) | Security | P2 | — | done |
| M0-10 | [Verify checksums of downloaded WASM parsers](M0-10-parser-checksum.md) | Security | P2 | — | done |
| M0-11 | [Write agent config safely (atomic + backup)](M0-11-install-atomic.md) | Security | P2 | — | done |
| M0-12 | [M0 gate: full verification + docs update](M0-12-m0-gate.md) | Gate | P0 | M0-01…M0-11 | todo |

Recommended order: 01 → 02 → 03 → 04 → (05, 06, 07 in parallel) → (08, 09, 10, 11 any time) → 12.

## M1 — Support every programming language (starts after M0)

Goal: every text source file is indexed at some level, with depth shown honestly per language through three tiers — **deep** (symbols + call graph + imports), **structural** (symbols + references via `tags.scm`), **text** (full-text + semantic search only).

| # | Task | Area | Priority | Depends on | Status |
|---|---|---|---|---|---|
| M1-01 | [Choose grammar source and distribution (spike + ADR)](M1-01-grammar-source-adr.md) | Research | P0 | M0-12 | todo |
| M1-02 | [Generic symbol extraction driven by tags.scm](M1-02-tags-query-engine.md) | Parsing | P0 | M1-01 | todo |
| M1-03 | [Language conformance test suite](M1-03-language-conformance-suite.md) | Test | P0 | M1-02 | todo |
| M1-04 | [Universal text tier for files without a grammar](M1-04-universal-text-tier.md) | Indexing | P1 | M1-03 | todo |
| M1-05 | [Grammar delivery: bundled core + verified download](M1-05-grammar-delivery.md) | Distribution | P1 | M1-01, M0-10 | todo |
| M1-06 | [Expose support tiers to agents and users](M1-06-support-tiers-visibility.md) | Tools | P1 | M1-04, M1-05 | todo |
| M1-07 | [Expand the deep tier to the most-used languages](M1-07-deep-tier-expansion.md) | Parsing | P2 | M1-02, M1-03 | todo |

Recommended order: 01 → 02 → 03 → (04, 05 in parallel) → 06 → 07 (one sub-task per language).

## M2 — Install once, works in every agent (starts after M0; can run in parallel with M1)

Goal: `npx -y hesman-mcp setup` configures every detected agent (Claude Code, Claude Desktop, Codex, Cursor, Antigravity, VS Code, Gemini CLI, Windsurf) with one global entry that works in any project, starts fast, and can be diagnosed.

| # | Task | Area | Priority | Depends on | Status |
|---|---|---|---|---|---|
| M2-01 | [Non-blocking startup: answer MCP first, index in background](M2-01-non-blocking-startup.md) | Server | P0 | M0-12 | todo |
| M2-02 | [Detect the project automatically (roots → cwd)](M2-02-project-root-detection.md) | Server | P0 | M0-12 | todo |
| M2-03 | [Client adapters + `hesman setup` / `remove`](M2-03-client-adapters-setup.md) | CLI | P0 | M0-11, M2-02 | todo |
| M2-04 | [Launch command that works in GUI apps and across Node upgrades](M2-04-launch-command-strategy.md) | CLI | P1 | M2-03 | todo |
| M2-05 | [`hesman doctor` end-to-end diagnostics](M2-05-doctor-command.md) | CLI | P1 | M2-03, M2-04 | todo |
| M2-06 | [One-click install links and ecosystem installers](M2-06-one-click-install.md) | Distribution | P2 | M2-04 | todo |
| M2-07 | [Opt-in agent usage rules](M2-07-agent-usage-rules.md) | Adoption | P2 | M2-03 | todo |

Recommended order: (01, 02 in parallel) → 03 → 04 → (05, 06, 07 in parallel).

## Backlog after M0 (not specified, not scheduled)

- **Answer-quality eval suite** — measure tokens *and* accuracy against an agent reading files directly (all four roles in the dev-team session agreed; codebase-memory-mcp's published weakness is 83% vs 92%).
- **ADR: daemon + stdio shim architecture** — prerequisite for multi-project and the dashboard.
- **Multi-project support** and **web dashboard** (bind 127.0.0.1, token-protected).
- **Dead code cleanup:** 7 config fields never read (`indexOnStartup`, `batchSize`, `maxMemoryMB`, `cacheSize`, `logFile`, `autoCleanDataDir`, `semanticSearch.embeddingCacheDir`), `src/monorepo/` module never wired in. (The no-op `install --global` flag is removed in M2-03.)
- **Minor functional bugs:** `get_references` cursor splits on `':'` and breaks on Windows paths; naive `.gitignore` matching (`build` also skips `buildscripts/`, no `*.log`, no `!negation`).
- **Zod validation** for every tool input (replace `as` casts).
- Evaluate replacing ZVec with an in-SQLite vector store to drop one store.
