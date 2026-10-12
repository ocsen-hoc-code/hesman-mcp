# Task Status

Updated: 2026-10-12 · **M0: 16/16 done** · **M1: 7/8 done** · **M2: 5/7 done** · **M3: 2/2 done**

Status conventions and update rules: see [`README.md`](README.md).

## M0 — Fix the foundation (before any new feature)

Goal: resolve the two blocking problems — **(1) broken core** and **(2) security holes** — with tests that run through the real server.

| # | Task | Area | Priority | Depends on | Status |
|---|---|---|---|---|---|
| M0-01 | [Real-server e2e harness + polyglot fixture](M0-01-e2e-harness.md) | Test | P0 | — | done |
| M0-02 | [Log to stderr through one shared logger](M0-02-logger-stderr.md) | Core | P0 | M0-01 | done |
| M0-03 | [Single language registry; index Python/Go](M0-03-language-registry.md) | Core | P0 | M0-01 | done |
| M0-04 | [Confine paths to the project root](M0-04-path-containment.md) | Security | P0 | M0-01 | done |
| M0-05 | [Safe ZVec filters; validate kind/language](M0-05-zvec-filter.md) | Security | P1 | M0-03 | done |
| M0-06 | [Prevent ReDoS and event-loop blocking in find_pattern](M0-06-find-pattern-hardening.md) | Security | P1 | M0-01 | done |
| M0-07 | [Scanner and watcher ignore symlinks](M0-07-symlink-safety.md) | Security | P1 | M0-03 | done |
| M0-08 | [Guard rails for `hesman clean`](M0-08-clean-guard.md) | Security | P1 | — | done |
| M0-09 | [Validate and clamp numeric tool arguments](M0-09-numeric-args.md) | Security | P2 | — | done |
| M0-10 | [Verify checksums of downloaded WASM parsers](M0-10-parser-checksum.md) | Security | P2 | — | done |
| M0-11 | [Write agent config safely (atomic + backup)](M0-11-install-atomic.md) | Security | P2 | — | done |
| M0-12 | [M0 gate: full verification + docs update](M0-12-m0-gate.md) | Gate | P0 | M0-01…M0-11, M0-13…M0-16 | done |
| M0-13 | [Correct call graph: no self-calls, cross-file calls](M0-13-call-graph-correctness.md) | Core | P0 | M0-14 | done |
| M0-14 | [One line-number convention: 1-based everywhere](M0-14-one-based-lines.md) | Core | P0 | — | done |
| M0-15 | [Accurate metadata: Go exports, index_status, reduction stats](M0-15-accurate-metadata.md) | Core | P1 | — | done |
| M0-16 | [Better semantic_search ranking (labeled eval)](M0-16-semantic-ranking.md) | Quality | P1 | — | done |

Recommended order: 01 → 02 → 03 → 04 → (05, 06, 07 in parallel) → (08, 09, 10, 11 any time) → (14, 15, 16 in parallel) → 13 → 12.

M0-13…M0-16 come from the M0-12 real-client smoke test (8/9). M0 closes only when the smoke test passes 9/9 with no issues.

## M1 — Support every programming language (starts after M0)

Goal: every text source file is indexed at some level, with depth shown honestly per language through three tiers — **deep** (symbols + call graph + imports), **structural** (symbols + references via `tags.scm`), **text** (full-text + semantic search only).

| # | Task | Area | Priority | Depends on | Status |
|---|---|---|---|---|---|
| M1-01 | [Choose grammar source and distribution (spike + ADR)](M1-01-grammar-source-adr.md) | Research | P0 | M0-12 | done |
| M1-02 | [Generic symbol extraction driven by tags.scm](M1-02-tags-query-engine.md) | Parsing | P0 | M1-01 | done |
| M1-03 | [Language conformance test suite](M1-03-language-conformance-suite.md) | Test | P0 | M1-02 | done |
| M1-04 | [Universal text tier for files without a grammar](M1-04-universal-text-tier.md) | Indexing | P1 | M1-03 | done |
| M1-05 | [Grammar delivery: bundled core + verified download](M1-05-grammar-delivery.md) | Distribution | P1 | M1-01, M0-10 | done |
| M1-06 | [Expose support tiers to agents and users](M1-06-support-tiers-visibility.md) | Tools | P1 | M1-04, M1-05 | todo |
| M1-07 | [Expand the deep tier to the most-used languages](M1-07-deep-tier-expansion.md) | Parsing | P2 | M1-02, M1-03 | done |
| M1-08 | [Fix the extraction bugs found by the conformance suite](M1-08-extraction-bug-fixes.md) | Parsing | P0 | M1-03 | done |

Recommended order: 01 → 02 → 03 → (04, 05 in parallel) → 06 → 07 (one sub-task per language).

## M2 — Install once, works in every agent (starts after M0; can run in parallel with M1)

Goal: `npx -y hesman-mcp setup` configures every detected agent (Claude Code, Claude Desktop, Codex, Cursor, Antigravity, VS Code, Gemini CLI, Windsurf) with one global entry that works in any project, starts fast, and can be diagnosed.

| # | Task | Area | Priority | Depends on | Status |
|---|---|---|---|---|---|
| M2-01 | [Non-blocking startup: answer MCP first, index in background](M2-01-non-blocking-startup.md) | Server | P0 | M0-12 | done |
| M2-02 | [Detect the project automatically (roots → cwd)](M2-02-project-root-detection.md) | Server | P0 | M0-12 | done |
| M2-03 | [Client adapters + `hesman setup` / `remove`](M2-03-client-adapters-setup.md) | CLI | P0 | M0-11, M2-02 | done |
| M2-04 | [Launch command that works in GUI apps and across Node upgrades](M2-04-launch-command-strategy.md) | CLI | P1 | M2-03 | pending |
| M2-05 | [`hesman doctor` end-to-end diagnostics](M2-05-doctor-command.md) | CLI | P1 | M2-03, M2-04 | done |
| M2-06 | [One-click install links and ecosystem installers](M2-06-one-click-install.md) | Distribution | P2 | M2-04 | todo |
| M2-07 | [Opt-in agent usage rules](M2-07-agent-usage-rules.md) | Adoption | P2 | M2-03 | done |

Recommended order: (01, 02 in parallel) → 03 → 04 → (05, 06, 07 in parallel).

M2-04 is code-complete and merged but stays `pending`: two acceptance checks are manual (Claude Desktop under nvm; an `npx` entry surviving a Node major switch) and the `npx` path cannot be exercised until `hesman-mcp` is published on npm (not published as of 2026-10-11 — the owner decides when). M2-06 (one-click install links) is on hold for the same reason: a static link can only carry the `npx` entry.

## M3 — Dashboard: logs, metrics, index graph, query playground

Goal: `hesman ui` opens a local web page (127.0.0.1 + token) to watch logs and metrics, explore the index as a graph and try queries. Requested by the owner on 2026-10-11. The two tasks share one API contract and run in parallel. Not started yet: the owner asked to fix the extraction bugs (M1-08) first.

| # | Task | Area | Priority | Depends on | Status |
|---|---|---|---|---|---|
| M3-01 | [Observability data + `hesman ui` backend (HTTP API)](M3-01-observability-and-ui-api.md) | Server | P0 | M0-12 | done |
| M3-02 | [Dashboard frontend](M3-02-dashboard-frontend.md) | UI | P0 | M0-12 | done |

Publishing to npm: the owner decided on 2026-10-11 not to publish yet, so M2-06 and the `npx` checks of M2-04 stay on hold.

## Backlog after M0 (not specified, not scheduled)

- **M1-07 remaining limits (call graph):** types are not resolved, so a method called on an interface with several implementations stays unlinked; a Ruby call with no receiver, arguments or parentheses is not seen; a C++ constructor call written as a declaration (`Item local(3);`) is not seen; Python `super().__init__()` links `__init__` to itself when the file has one `__init__`; Bash records every command as an unresolved call; Java annotation-as-signature is untouched; no import relations for Java, C#, Kotlin, Swift, PHP, Rust, Lua, Bash; `extends` / `implements` are still regexes; unused `relationQueries` strings remain in the ts/python/go profiles; no e2e assertion for the new languages' call graph through the real server. This supersedes the call-graph part of "Language limits recorded by M1-05a".
- **M1-05b follow-ups (on-demand grammars):** Elixir's upstream tags query is Apache-2.0 and is not vendored (owner decision needed: allow a grammar's own Apache-2.0 query?); only R is compiled offline in tests, the other five on-demand queries are checked by the network script `scripts/verify-grammar-catalog.ts`; the watcher does not request a grammar for a new file of an uncached language (next indexing pass does); the follow-up indexing pass can overlap the watcher; 18 pinned grammars have no tags query and stay on the text tier; not built: a Hesman-built grammar pack (ADR 4.1.3) and `scripts/update-grammars.ts` (ADR 4.4); many languages have no upstream `.wasm` release asset (Dart, SQL, Dockerfile, Erlang, Nix, Vue, Svelte, …) and therefore stay text.
- **M3-02 follow-ups (dashboard frontend):** proposed contract additions not made: `tier` in `index.languages[]` (the UI keeps a tested copy of the tier table), `signature` / `docComment` on graph nodes (today one extra `find_symbol` call per selected symbol), a stable `id` per log entry, `/api/logs` `level` documented as "this level and above", and whether playground runs should appear in Metrics (today they do not). Graph limits: O(n²) synchronous layout, 300-node cap, no node dragging, dense file graph. Not checked: screen reader, Firefox, Safari, measured contrast ratios. The backend test named "serves the placeholder page…" has a stale name. `hesman index` aborts with `database disk image is malformed` on a corrupt `symbols.db` instead of rebuilding it (seen on an old v1.0 index in this repository). The call graph of this repository links `.map(` / `.join(` calls to project symbols named `map` / `join` and names variables (`result`) as callers — check after M1-07.
- **M3-01 follow-ups (dashboard backend):** `ReadOnlySqliteStore` reaches into `SqliteStore`'s private `db` through a cast (add a proper `openReadOnly()`); `/api/graph/search` is a `LIKE '%q%'` scan; `/api/logs` re-reads up to 10 MB per request; a `logFile` placed inside the project but outside the data directory is seen by the file watcher (no guard); the dashboard cannot run `semantic_search` (ZVec exclusive lock) or show live indexing progress; Windows and the browser-open path are unverified. One `npm test` run in five failed 2 tests while three other agents were running suites (load average ~40); not reproduced in four further runs, the cause was a fixed temp directory shared by every checkout in `tests/unit/indexing/file-watcher.test.ts` (fixed: one `mkdtemp` directory per test).
- **Answer-quality eval suite** — measure tokens *and* accuracy against an agent reading files directly (all four roles in the dev-team session agreed; codebase-memory-mcp's published weakness is 83% vs 92%).
- **ADR: daemon + stdio shim architecture** — prerequisite for multi-project and the dashboard.
- **Multi-project support** and **web dashboard** (bind 127.0.0.1, token-protected).
- **Dead code cleanup:** 7 config fields never read (`indexOnStartup`, `batchSize`, `maxMemoryMB`, `cacheSize`, `logFile`, `autoCleanDataDir`, `semanticSearch.embeddingCacheDir`), `src/monorepo/` module never wired in. (The no-op `install --global` flag is removed in M2-03.)
- **Minor functional bugs:** `get_references` cursor splits on `':'` and breaks on Windows paths; naive `.gitignore` matching (`build` also skips `buildscripts/`, no `*.log`, no `!negation`).
- **Make `_summary` actually save tokens:** today it is purely additive, so M0-15 drops it whenever it would enlarge a response (always, in practice). Replace long lists with the summary plus the top-N entries so list tools (`get_references`, `get_callers`, `list_dependencies`, …) really shrink, and measure it.
- **Embedding model: keep MiniLM as default, consider EmbeddingGemma 2 as an opt-in quality mode.** Measured 2026-10-11 on macOS/CPU with a scratch benchmark that embeds the exact chunk texts Hesman produces (Hesman's compiled parser + chunker) and ranks by cosine; the MiniLM run reproduced the M0-16 numbers on the fixture (hybrid hit@3 1.000, MRR 0.952), so the harness matches production.
  - Corpus: Hesman's own `src/` (52 files, 388 chunks, 88 chunks > 1000 chars, longest 18k chars), 30 hand-written paraphrase queries with expected symbols. One run each; 30 queries is a small set, so differences of one or two queries are noise.

    | Model / config | hit@1 | hit@3 | MRR | Index time (388 chunks) | Query embed | Peak RSS |
    |---|---|---|---|---|---|---|
    | all-MiniLM-L6-v2, vector only | 0.600 | 0.767 | 0.704 | 6.8 s | 1.6 ms | 310 MB |
    | all-MiniLM-L6-v2, hybrid 0.7/0.3 (current default) | 0.567 | 0.800 | 0.692 | 6.8 s | 1.6 ms | 310 MB |
    | EmbeddingGemma 2 q8, full text, 768d, vector only | 0.767 | 0.833 | 0.825 | 99 s | 45 ms | 4130 MB |
    | EmbeddingGemma 2 q8, text capped at 2000 chars, 768d | 0.700 | 0.833 | 0.774 | 74 s | 44 ms | 979 MB |
    | EmbeddingGemma 2 q4, capped at 2000 chars, 768d | 0.733 | 0.867 | 0.811 | 59 s | 20 ms | 1155 MB |
    | EmbeddingGemma 2 q4, capped at 2000 chars, 256d | 0.700 | 0.867 | 0.790 | 59 s | 20 ms | 1155 MB |

  - Findings: EmbeddingGemma 2 ranks better on real code (MRR +0.09 to +0.12, hit@1 +10 to +17 points) but indexes 9–15x slower, needs ~1 GB RAM with capped inputs (4 GB uncapped) against the 350 MB project budget, and query embedding takes 20–45 ms against the 10 ms search target. The 0.7/0.3 lexical blend tuned for MiniLM **hurts** EmbeddingGemma 2 (MRR 0.66–0.69), so it must use vector-only ranking or a re-tuned weight. Truncating to 256 dimensions costs little quality. Uncapped long functions drive the memory peak.
  - If adopted: migrate `@xenova/transformers` 2.x → `@huggingface/transformers` ≥ 4.3.1, use `onnx-community/embeddinggemma-2-ONNX` (Apache 2.0) with the `task: code retrieval | query: …` and `title: … | text: …` prompts, make the model, vector dimension, input cap and lexical weight configurable, bump the index schema version, and re-run this comparison on a larger labeled set before changing any default.
- **Verify on Linux and Windows:** M0 was verified on macOS only (no CI). Symlink tests are skipped on Windows; path handling there is untested.
- **i18n READMEs:** their prose still describes `_summary` as current behavior (numbers were corrected in M0-12); needs a translator.
- **Startup follow-ups from M2-01:** (1) the final call-linking pass `resolveCallRelations` is one synchronous block (791 ms for 30,000 calls on a 6,000-file fixture) and `scanProject` is synchronous too, so requests wait during them — resolve per chunk (needs an index on `relations(file_path)`); (2) in semantic mode indexing waits for the embedding model, so on a first-run download structural tools see an empty index until the download ends — decouple with a second embedding pass.
- **Project-root follow-ups from M2-02:** (1) `hesman.config.json` is looked up from the working directory, not from a root learned through MCP roots, so a project's config is not applied when the server starts elsewhere — the main gap for a truly global entry; (2) an absolute `dataDir` is shared by every project one process serves; (3) a tool call running while the root changes can fail with `INTERNAL_ERROR` because its store closes under it; (4) after a `roots/list` timeout, roots are not asked again until the client sends `list_changed`; (5) `CLAUDE_PROJECT_DIR` (set by Claude Code) could be a cheap extra fallback; (6) `docs/ARCHITECTURE.md` and the i18n READMEs do not describe the new startup and project selection yet.
- **Client-setup follow-ups from M2-03:** config files with comments or trailing commas (JSONC — possible for VS Code `mcp.json` and Gemini `settings.json`) are refused instead of edited; the Codex TOML editor refuses inline-table/dotted-key forms; VS Code Insiders, VSCodium and non-default profiles are not handled; all Windows behavior is tested only as path logic on macOS; nothing was tested against real Cursor, Antigravity, Windsurf, Codex or Gemini CLI installations; `docs/i18n/README.*.md` and `docs/SECURITY.md` still mention `hesman install`.
- **Text-tier follow-ups from M1-04:** indexing this repository takes 46–61% longer with the text tier (17–19 s → 28 s; +60 files, +343 chunks, data dir +17%), almost all of it Markdown (49 files / 330 chunks) — consider a config switch or a cheaper default for prose; no SQLite FTS table exists for chunk text (ZVec holds it); `indexProject` still does not remove files deleted while the server was down (only the watcher's unlink does); README and `docs/ARCHITECTURE.md` do not describe the text tier yet; text labels (`javascript`, `cpp`, `csharp`, `shell`) must be reconciled with registry ids when M1-05 adds grammars.
- **Symbol-extraction follow-ups from M1-02 (owner decisions pending):** (1) function-valued constants (`const f = () => …`) are now kind `function`, not `variable`, so their ids changed and calls inside them are attributed to them; (2) functions assigned to object keys or properties (`{ onClick: () => … }`, `module.exports.h = …`) are new callable symbols, and the call resolver's whole-project tier can link an unrelated call to one whose name is unique — consider excluding property-assigned functions from that tier; (3) local variables inside function bodies are still indexed as symbols (they are already excluded from the semantic index); (4) `docs/ARCHITECTURE.md` still describes hand-written profiles; (5) not verified on Node 20.
- **Test stability under load:** `FileWatcher symlink safety` timed out once (5.5 s) while other test runs shared the machine; the legacy e2e files used a fixed 3 s sleep (fixed in `05215e7`). Re-check watcher tests for timing assumptions.
- **Agent-rules follow-ups from M2-07:** the effect of the guidance block on real agent tool usage was **not measured** (needs the answer-quality eval or a manual before/after run); `hesman setup --rules` leaves `<file>.hesman.bak` backups (e.g. `CLAUDE.md.hesman.bak`) inside the repository, where they can be committed by accident — skip backups for instruction files or document a `.gitignore` entry; VS Code's Local agent only reads `.github/copilot-instructions.md` when `github.copilot.chat.codeGeneration.useInstructionFiles` is enabled, which setup does not mention; `hesman remove` only cleans the current project; per-client instruction-file facts came from doc summaries and were not tested against real clients.
- **Doctor follow-ups from M2-05:** project-scope config files, the `env` block of an entry and the PATH a desktop app really gets are not checked; `--client` parsing and aliases are duplicated from `setup.ts` (export `parseOptions` and share it); the registry check for `npx` entries has no offline flag (unreachable is only a warning).
- **Extraction bugs found by the conformance suite (M1-03), recorded as `knownGaps` in `tests/fixtures/languages/*/expected.json`:** (1) JSX/TSX files parsed with the TypeScript grammar produce 11–14 ERROR nodes and an arrow-function component is indexed as `variable` (fixed by M1-05's separate `tsx`/`javascript` entries); (2) `isNodeExported` reports declarations local to an exported function, and `private` members of an exported class, as exported; (3) CommonJS `module.exports = { … }` is not recognized as an export; (4) Python tuple assignment (`A, B = 1, 2`) is not indexed; (5) the regex call extractor emits false calls (interface method specs, format strings such as `"%s ("`); (6) a multi-line TypeScript constructor gets the signature `constructor(`. Fixing 2–4 changes stored symbols and needs a schema-version bump.
- **Language limits recorded by M1-05a (16 bundled grammars):** c, cpp, ruby and bash are `structural` (no call graph: prototype + definition are two same-named callables in C/C++; Ruby and Bash calls have no parentheses); Java/C# `new X(...)` is not linked when the class declares a constructor; an interface method and its implementation are two same-named callables (Java, C#, Kotlin, Swift, PHP), so cross-file calls to them stay unresolved; kinds follow the upstream queries and are coarse in places (PHP/Kotlin methods are `function`, Rust enums and Swift structs are `class`, C++ member functions are `function`); false unresolved calls from `foreach (`, `when (`, Lua `function(`; a Java method with an annotation on its own line gets the annotation as its signature; import relations exist only for ES `import … from`. Most of these belong to M1-07 (query-based relations).
- **Follow-ups from M1-08:** `protected` class members and function-valued keys of an exported object are treated as not exported (owner may revisit); the call regex still accepts an anonymous `function (…)` / Go `func(…)` literal as a callee (belongs to M1-07); `docs/ARCHITECTURE.md` does not mention `symbols.is_property`.
- **Zod validation** for every tool input (replace `as` casts).
- Evaluate replacing ZVec with an in-SQLite vector store to drop one store.
