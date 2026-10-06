---
id: M0-12
title: M0 gate — full verification and docs update
status: todo
priority: P0
depends_on: [M0-01, M0-02, M0-03, M0-04, M0-05, M0-06, M0-07, M0-08, M0-09, M0-10, M0-11]
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

## Out of scope

- Version bump and npm publish — the project owner decides.

## Acceptance criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` pass locally.
- [ ] CI is green on all 3 OSes × Node 20/22.
- [ ] The step-2 smoke test passes; results recorded in *Progress notes*.
- [ ] Every task M0-01…M0-11 has `status: done` in both its file and `STATUS.md`.

## Verification

```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run test:e2e
```

## Progress notes

- 2026-10-06: task created.
