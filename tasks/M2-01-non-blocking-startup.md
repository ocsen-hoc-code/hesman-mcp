---
id: M2-01
title: Non-blocking startup — answer MCP immediately, index in the background
status: todo
priority: P0
depends_on: [M0-12]
updated: 2026-10-06
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

- [ ] e2e: on a generated fixture large enough that indexing takes > 5s, `initialize` and `tools/list` succeed within 1s.
- [ ] `index_status` shows increasing progress during indexing and `inProgress: false` afterwards.
- [ ] A tool call during indexing returns results plus the `indexing` marker; no call fails because indexing is running.

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-06: task created.
