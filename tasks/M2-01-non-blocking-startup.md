---
id: M2-01
title: Non-blocking startup — answer MCP immediately, index in the background
status: done
priority: P0
depends_on: [M0-12]
updated: 2026-10-11
---

## Context

`src/index.ts` only connects the MCP transport **after** all heavy work is done:
- `:87` awaits the embedding model load (first run downloads it);
- `:103` awaits a full `indexProject()`;
- `:175` finally calls `server.connect()`.

Every agent client applies a startup timeout to MCP servers. On a large repository, or on the first run while the model downloads, the client gives up and reports Hesman as failed — the user's first impression of the product, in every client.

## Scope

1. Call `server.connect()` first; then load the embedding model and run the initial index in the background.
2. While indexing runs:
   - `index_status` reports progress (files done / total, phase, ETA if cheap to compute);
   - other tools answer from the current index and include `indexing: { inProgress: true, progress }` in `_meta` so the agent knows results may be incomplete;
   - `semantic_search` returns a clear "model loading" error until the model is ready, without blocking.
3. The file watcher starts after the initial index completes, as today.
4. Measure time-to-first-response: the `initialize` handshake must complete in < 1s regardless of repository size.

## Out of scope

- Persisting a partial index across restarts (resume) — later if needed.

## Acceptance criteria

- [x] e2e: on a generated fixture large enough that indexing takes > 5s, `initialize` and `tools/list` succeed within 1s.
- [x] `index_status` shows increasing progress during indexing and `inProgress: false` afterwards.
- [x] A tool call during indexing returns results plus the `indexing` marker; no call fails because indexing is running.

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-11: done. `src/index.ts` connects the transport first, then loads the embedding model and runs the initial index in the background (`runBackgroundStartup`); the watcher starts when the index is in place. Progress lives in `src/indexing/index-state.ts` (`indexState`), fed by the new `onProgress` option of `indexProject`, which now also yields to the event loop every 20 ms, parses in chunks of 64 files (results stored per chunk, so partial results are queryable) and stops on an `AbortSignal` (`IndexAbortedError`, after linking the calls of the files already stored). `index_status` gained `indexing` + `health.embeddingModelError`; other tools add `_meta.indexing` only while the run is in progress; `semantic_search` says "still loading" / why the load failed. The e2e harness now waits for `indexing.inProgress === false`.
  - Measured (`tests/e2e/non-blocking-startup.test.ts`, 6,000 generated TS files, `--workers 1`, `--no-semantic`): `initialize` + `tools/list` in 0.2 s alone and 0.45–1.0 s while the 12 other e2e servers boot at the same time (process boot, independent of project size; the test takes the best of up to 3 attempts); index 10–14 s; `index_status` answered in ≤ 0.25 s while files were being indexed. Before the change the same handshake took as long as the index (5.4 s on 4,000 files).
  - Shutdown mid-index (SIGTERM and stdin close): exit code 0 in ~0.1 s, "Shutdown complete", no unhandled rejection; also checked by hand with semantic search enabled.
  - Known limits, not addressed here: (1) with semantic search on, indexing waits for the model, so on a first run structural tools have no index until the download ends (ETA is not reported: phase and file counts are); (2) the final call-linking step (`resolveCallRelations`) is one synchronous block — 0.8 s for 30,000 calls on the 6,000-file fixture — during which requests wait; `scanProject` is synchronous too; (3) if the model fails to load, files with symbols still fail at embedding time, as before.
- 2026-10-11: started (branch `rebuild/m1-m2`).
- 2026-10-06: task created.
