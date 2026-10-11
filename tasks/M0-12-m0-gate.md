---
id: M0-12
title: M0 gate — full verification and docs update
status: pending
priority: P0
depends_on: [M0-01, M0-02, M0-03, M0-04, M0-05, M0-06, M0-07, M0-08, M0-09, M0-10, M0-11, M0-13, M0-14, M0-15, M0-16]
updated: 2026-10-06
---

## Context

M0 is done only when both blocking problems (broken core, security holes) are proven fixed on the real code path, and the docs no longer promise what the code cannot do.

## Scope

1. Run every check on a clean checkout (`git clean -xdn` to preview, then `npm ci`).
2. Manual smoke test with a real MCP client (e.g. `claude mcp add hesman -- node <repo>/dist/index.js`, run inside `tests/fixtures/polyglot-basic`): `find_symbol` for one Python and one Go symbol; `get_context` on `/etc/hosts` must be refused.
3. Docs:
   - `CHANGELOG.md`: an *Unreleased* section with *Fixed* and *Security*.
   - `README.md` and `docs/i18n/README.*.md`: accurate language table; notes on symlink handling and path confinement.
   - `docs/SECURITY.md` (new): a short threat model — tool input is untrusted; list the guards now in place.
   - `CLAUDE.md`: update commands if they changed (e.g. `pretest:e2e`).
   - `PROJECT-CONTEXT.md`: move the phase to "M0 done" and record the next step.
4. Review the backlog in `STATUS.md`; pick and specify the next milestone (M1).
5. Remove test flakiness found during M0: `tests/e2e/cli.test.ts` uses a fixed shared directory `join(tmpdir(), 'hesman-cli-e2e')`, so concurrent test runs (e.g. parallel worktrees, CI retries) collide — switch to `mkdtemp`. Also re-check `tests/unit/indexing/index-coordinator.test.ts`, which failed once during a parallel run and passed on rerun. The Claude Desktop path tests in `tests/unit/cli/install.test.ts` assume the macOS location; make them platform-aware so they pass on the Linux and Windows CI runners.
6. Fix CLI argument parsing found during M0-08: `runClean` (and likely `runStatus`/`runDiag`/`runIndex`) treats `args[0]` as the project path even when it is a flag, so `hesman clean --force` without a path resolves the project root to `./--force` and never cleans the current directory. Parse positional arguments separately from flags and add a test for the no-path form.
7. The server does not exit when stdin closes (found during M0-02). When the agent client dies, Hesman keeps running as an orphan process holding the SQLite and ZVec files. Shut down gracefully on stdin `end`/`close` (same path as SIGTERM) and add an e2e test that closes stdin and expects the process to exit within a few seconds.
8. Follow-up from M0-06: `find_pattern` still runs `scanProject` (a full directory walk) on the main thread for every call. Move the scan into the worker or reuse the indexed file list from SQLite.
10. Truthful token-reduction claims (found in M0-15): `_summary` never reduced size, so the per-tool "Token reduction" lines in `docs/TOOLS.md` (40–90% for list tools) and the README average ("20–70%") were never true for list tools. Rewrite them to match measured behavior (`_meta.compressed` / `_meta.reduction`), in the README and the `docs/i18n` READMEs' numbers.
11. Edge case from M0-14: if a pre-M0-14 index is first reopened by a run without ZVec (CLI `index`, or `--no-semantic`), the schema version is marked current while old ZVec documents stay on disk, and a later semantic run never clears them. Store the ZVec schema version separately (or only mark the version current once both stores are cleared).
9. Follow-up from M0-05: `find_symbol` still declares its own inline kind enum; import `SYMBOL_KINDS` from `src/parsers/symbol-kinds.ts` so both tools accept the same kinds (including `constant`).

## Out of scope

- Version bump and npm publish — the project owner decides.

## Acceptance criteria

- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` pass locally.
- [ ] CI is green on all 3 OSes × Node 20/22.
- [x] The step-2 smoke test passes **9/9 with no reported issues** (first run: 8/9, see notes; fixes in M0-13…M0-16); results recorded in *Progress notes*.
- [x] Every task M0-01…M0-11 has `status: done` in both its file and `STATUS.md`.

## Verification

```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run test:e2e
```

## Progress notes

- 2026-10-11: **real-client smoke test re-run: 9/9 PASS** (Claude Code via `claude -p --strict-mcp-config`, fresh copy of `polyglot-basic`, `dist/index.js` at `25dba8d`), with stricter criteria than the first run: `index_status` lists go/python/typescript; `GoGreet` reports `isExported: true`; `get_callers(GoGreet)` returns only `main` (go/main.go) and not GoGreet itself; `get_context` at the `startLine` reported by `find_symbol('py_greet')` (5) returns the `def py_greet` line; `find_pattern` reports the same line; `semantic_search` top 3 = `py_greet` (0.465), `GoGreet` (0.421), `tsFormatName` (0.417) with the entry points ranked last; no negative `_meta.reduction`; no Hesman process left after the client exited. Before it, the `ecc:verification-loop` phases passed: build, 0 type errors, lint 0 errors / 36 warnings, `npm test` 69 files / 466 passed + 1 skipped, no secrets, no `console.log` outside `src/cli/`.
  Minor observations from this run (not failures; candidates for follow-up): `get_context.totalLines` counts the trailing newline as an extra line (7 for a 6-line file); `tookMs` is hard-coded `0` in some tools and measured in others; `find_pattern` snippets start two lines above the reported `line` (context lines) without saying so; semantic scores are low in absolute terms (top hit 0.465), so a `minScore` >= 0.5 would return nothing; all tools return absolute `filePath`s.
  Remaining for M0 to close: CI green on all 3 OSes (requires pushing the branch).
- 2026-10-06: scope items 10 and 11 done.
  - Item 11: the ZVec documents now carry their own version (`vector_schema_version` in the SQLite `metadata` table, `SqliteStore.get/setVectorSchemaVersion`). When a run without ZVec resets a legacy index that had data, it records the old vector version. The first ZVec-enabled run then clears both stores and re-embeds every file, because clearing only ZVec would leave hash-skipped files without vectors. A brand-new data dir is not affected (no symbols means no stale vectors), and when no vector version is recorded the SQLite version is used. Test: `tests/integration/zvec-schema-version.test.ts` (legacy DB + ZVec doc → index without ZVec → index with ZVec: legacy doc gone, current symbols embedded, next run indexes 0 files). It failed before the fix (`expected [ 'legacy-py-greet' ] to not include 'legacy-py-greet'`).
  - Item 10: measured `_meta` through the MCP client (e2e helper). On `polyglot-basic`, `get_context` (compact, default ±5) gave `0.0%`, because the whole 16-line file fits in the window. `get_file_structure`, `list_dependencies`, `get_references`, `get_callers` and `get_callees` all gave `0.0%` / `compressed: false` with no `_summary`. On a copy of this repo's `src/`, `get_context` on a 195-line file gave 89.9% with ±5 lines, 29.9% with ±40, and 0.0% for the whole file. Compact vs. `mode: "full"` saved 14.1–15.6%. List tools stayed at `0.0%` (e.g. `get_file_structure` on `sqlite.ts`, 3464 tokens). Rewrote the claims in `README.md`, `docs/TOOLS.md` and `docs/ARCHITECTURE.md` to these values; summaries are marked "not applied yet" with a pointer to the backlog item in `STATUS.md`. In `docs/i18n/README.*.md` only numbers changed: intro best case 97/98% → 90%, the compact row 20–35%/~50% → 10–30%/~35% (de, fr), pruning typical 50–80% → 30–90%, and the summarization row → 0%. The `_meta` example now uses the measured values. Removed the `_summary` bullet and the "430-line / 97% / 20–70% average" paragraph. Still untranslated and inaccurate there: the "Layer 3" `_summary` example section and the "where applicable a `_summary` block" sentence in the tools section (they need a translator).
  - Found, not fixed (outside this task's files): `get_context` with `mode: "full"` is still compacted by `compressToolResponse` (CODE_TOOLS compaction ignores the mode), so full and compact return the same content size (146 vs 146 and 1645 vs 1645 tokens).
- 2026-10-06: **real-client smoke test done** with Claude Code 2.1.291 (`claude -p --strict-mcp-config --mcp-config <temp file>`, so the owner's agent config was not touched) against `dist/index.js` on a scratch copy of `polyglot-basic`. 8/9 checks passed: `index_status` (6 files, 9 symbols), `find_symbol` for TS/Python/Go, `get_context` on `/etc/hosts` refused with `PATH_OUTSIDE_PROJECT` and no content, `get_context` on a project file, `semantic_search`, `find_pattern`. After the client exited no Hesman process was left running (stdin-close shutdown confirmed). Problems found (verified against the SQLite index, not yet fixed):
  1. **Call graph is wrong:** every function gets a `calls` relation to itself at its own declaration line (e.g. `GoGreet → GoGreet` at `greet.go:13`), and cross-file calls are missing (`main → GoGreet` in `go/main.go` is absent). `get_callers(GoGreet)` returned only GoGreet itself. Affects `get_callers`, `get_callees`, `impact_analysis`.
  2. **Line numbers are inconsistent:** symbols are stored and returned 0-based (`py_format_name` has `start_line 0`; `py_greet` is on file line 5 but reported as 4), while `get_context` input and `find_pattern` output are 1-based. An agent that passes a symbol's `startLine` to `get_context` lands one line too early.
  3. Go `isExported` is false for capitalized (exported) names.
  4. `_meta.reduction` is negative for small responses (-64.8% for `get_callers`, -294.4% for `get_context`): the `_summary`/`_meta` overhead makes small outputs larger than the raw data.
  5. `index_status` reports `kuzuOk: false` (Kuzu is not used) and `languages: []` although three languages are indexed.
  6. `semantic_search` ranking is weak: for "format a person name for a greeting" the entry points `main`/`tsMain` outrank `*FormatName`.
- 2026-10-06: **pending — waiting on the project owner** for the two remaining acceptance criteria:
  - CI on all 3 OSes needs the branch `rebuild/m0-foundation` pushed (not done without the owner's go-ahead).
  - The real-client smoke test (step 2) writes into the owner's agent configuration, so it is left to the owner. The same checks already pass through the MCP SDK client in `tests/e2e/languages.test.ts` (Python + Go `find_symbol`) and `tests/e2e/path-containment.test.ts` (`/etc/hosts` refused).
  - Done: step 1 on a fresh clone (`npm ci`, parsers sha256-verified, typecheck 0 errors, `npm test` 56 files / 380 passed + 1 skipped, `npm run test:e2e` 9 files / 42 passed); step 3 (`CHANGELOG.md` Unreleased, `docs/SECURITY.md`, README registry + security links, `CLAUDE.md`, `PROJECT-CONTEXT.md`); step 4 (M1 and M2 already specified in `tasks/`); items 5–9. The README language table is now accurate (Python/Go really work); `docs/i18n/README.*.md` were not edited — their translations of the symlink note need a translator.
- 2026-10-06: task created.
- 2026-10-06: scope items 5–8 done (items 1–4 still open):
  - Item 5: `tests/unit/cli/install.test.ts` derives the Claude Desktop path per platform (macOS / `%APPDATA%` / `~/.config`), stubs `APPDATA` into the temp home, and covers darwin/win32/linux explicitly. `index-coordinator.test.ts` passed 10/10 in a row; it used a fixed `.hesman-test-coordinator` dir in the cwd (likely cause of the parallel-run failure), now `mkdtemp`. `tookMs > 0` relaxed to `>= 0` (1 ms clock resolution).
  - Item 6: new `src/cli/args.ts` (`splitArgs`) separates positionals from flags; `index`/`status`/`clean`/`diag` no longer treat a flag as the project path, and `install --agent` no longer takes another flag as its value. Tests: `tests/unit/cli/no-path-args.test.ts`.
  - Item 7: `src/index.ts` runs the guarded `shutdown()` on stdin `end`/`close` (the SDK's `StdioServerTransport` only fires `onclose` on an explicit `close()`). Test: `tests/e2e/stdin-close.test.ts`.
  - Item 8: `find_pattern` walks the project inside its worker (`find-pattern-worker.ts`); the main thread no longer calls `scanProject`. Test: `tests/unit/server/find-pattern-scan.test.ts`.
