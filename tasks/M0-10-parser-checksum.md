---
id: M0-10
title: Verify checksums of downloaded WASM parsers
status: todo
priority: P2
depends_on: []
updated: 2026-10-06
---

## Context

`scripts/download-parsers.ts`:
- Downloads 3 WASM files from GitHub Releases and writes them straight into `parsers/` with **no integrity check**. If a different binary is served (tampered in transit or at the source), it runs inside the server.
- `:13` `new URL('../parsers', import.meta.url).pathname` breaks when the path contains spaces (becomes `%20`) and on Windows (becomes `/C:/...`). CI runs this script on Windows on every build.

The WASM files are already committed to git, so canonical copies exist to derive checksums from.

## Scope

1. Use `fileURLToPath` instead of `.pathname`.
2. Declare each parser as `{ url, sha256 }`; take the sha256 values from the files currently committed in `parsers/`.
3. If a file already exists with the correct hash → skip the download.
4. After download: hash mismatch → error, **do not write the file**, exit code 1.
5. Extract the hash check into a function so it can be unit-tested.

## Out of scope

- Adding parsers for new languages.

## Acceptance criteria

- [ ] Unit test: correct hash → accepted; wrong hash → rejected and no file written.
- [ ] Running the script twice in a row: the second run downloads nothing.
- [ ] The script works when the repo path contains spaces.

## Verification

```bash
npx tsx scripts/download-parsers.ts && npx tsx scripts/download-parsers.ts
git status parsers/   # unchanged
```

## Progress notes

- 2026-10-06: task created.
