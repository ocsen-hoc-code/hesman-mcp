---
id: M1-04
title: Universal text tier for files without a grammar
status: done
priority: P1
depends_on: [M1-03]
updated: 2026-10-11
---

## Context

No grammar collection covers every language, and some grammars may be unavailable offline. "Support every language" therefore needs a floor: **every text source file is indexed at some level**, even without a parser. Today, files with an unknown extension are skipped entirely by `src/indexing/project-scanner.ts`.

## Scope

1. Files not covered by a grammar (unknown extension, or grammar unavailable) are indexed as text:
   - chunk by blank-line-separated blocks, capped at a maximum number of lines per chunk;
   - store chunks for FTS and semantic search;
   - `get_context`, `semantic_search` and `find_pattern` work on them.
2. Skip binaries (NUL byte in the first 8 KB) and respect the existing size limit and ignore rules.
3. Language label from a broad extension table (e.g. derived from GitHub Linguist data), defaulting to `text`.
4. Results from this tier carry `precision: "text"` so agents know they are not symbol-accurate.

## Out of scope

- Symbol extraction for these files (that is what adding a grammar is for).

## Acceptance criteria

- [x] A fixture file with an extension that has no grammar is found by `semantic_search` and `find_pattern`, and `get_context` returns its lines.
- [x] A binary file in the fixture is skipped.
- [x] Results from this tier are marked `precision: "text"`.

## Verification

```bash
npm test && npm run test:e2e
```

## Progress notes

- 2026-10-11: merged into `rebuild/m1-m2` (commit `56f332d`); `src/index.ts` now passes `maxFileSizeBytes` and `languages` to the `FileWatcher`. After the merge `npm test` passes 89 files / 959 tests + 1 skipped.
- 2026-10-11: done on branch `worktree-agent-a9918d8ff2787d515` (commit recorded by the coordinator when it is merged into `rebuild/m1-m2`). Decisions:
  - **Inclusion rule** (`src/indexing/text-file-filter.ts`, documented in `docs/TOOLS.md` "Text tier"): a file without a grammar is indexed unless it is a secret (`.env*`, keys), a lockfile, a non-source extension (images, archives, compiled, office), generated (`*.map`, `*.min.*`, ...), bulk data (`.csv`, `.log`, ...), empty, over 256 KB, binary (NUL in the first 8 KB) or minified (a line over 2,000 characters in the first 8 KB). Scanner rules (ignore files, dot and always-ignored directories, symlinks, `maxFileSizeBytes`) apply first.
  - **Labels**: `src/parsers/text-languages.ts`, hand-written, names aligned with GitHub Linguist (MIT, attribution in the file header); unknown -> `text`.
  - **Storage**: one SQLite row per file (`text_files`: language, line count, chunk count) and one ZVec document per chunk (`kind: "text"`). Chunk ids are `sha256(path:text-chunk:index)[0..16]`, so they are stable for an unchanged file and can be rebuilt from the chunk count for deletion. No SQLite FTS table was added: no tool queries one, `find_pattern` and `get_context` read the files from disk (so they work with `--no-semantic`), and the chunk text is FTS-indexed in ZVec's `code` field like symbol code.
  - **Lifecycle**: same as symbols — file hash, `deleteByFile`, watcher change/unlink; a file that changes tier (grammar appears or disappears) is re-indexed even though its hash is unchanged.
  - **Marking**: text results carry `precision: "text"`; symbol results carry no `precision` field. In `find_pattern` the marker is one top-level field (a call searches one language).
  - **Schema**: `INDEX_SCHEMA_VERSION` 2 -> 3.
  - **Cost on this repository** (173 parsed files, 4 workers, embedding on): +60 text files / +343 chunks (330 of them Markdown); index time 17.3–19.2 s -> 27.9–28.1 s; data dir 11.5 MB -> 13.5 MB. Below the "doubles" limit, so the rules were not tightened further.
  - **Not done here**: `src/index.ts` does not pass `maxFileSizeBytes` / `languages` to `FileWatcher` (the watcher uses the defaults for text files); tiers in `index_status` per language are M1-06.
- 2026-10-11: started (branch `rebuild/m1-m2`), in parallel with M1-02; the dependency on M1-03 is soft (the text tier does not need the conformance suite to be built).
- 2026-10-06: task created.
