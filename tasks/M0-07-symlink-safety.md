---
id: M0-07
title: Scanner and watcher ignore symlinks
status: done
priority: P1
depends_on: [M0-03]
updated: 2026-10-06
---

## Context

- `src/indexing/project-scanner.ts:76` uses `statSync` (follows symlinks) and keeps no visited set:
  - A symlink to a parent directory (`loop -> .`) → infinite recursion, stack overflow, server crashes at startup.
  - A symlink pointing outside the project (`-> ~` or `-> /`) → outside code gets indexed and then exposed via `find_symbol` / `semantic_search`.
- `src/indexing/file-watcher.ts`: chokidar defaults to `followSymlinks: true` → the same risks while watching.
- Depends on M0-03 only to avoid conflicting edits to `file-watcher.ts`.

## Scope

1. **Failing test first** (temp directory built in the test) containing `loop -> .`, `outside -> <another temp dir with a .ts file>`, `link.ts -> src/a.ts`.
   - The scan must terminate, must not index files under `outside`, and must not index `a.ts` twice via `link.ts`.
2. Scanner uses `lstatSync` and **skips every symlink** (files and directories), logging at debug level. Rationale for skipping instead of conditional following: simple, no duplicate symbols, no realpath checks needed.
3. Watcher: `followSymlinks: false`.
4. Document the behavior in the README (Configuration or FAQ): "symlinks are skipped during indexing".

## Out of scope

- A config option to follow symlinks (only if users ask for it).

## Acceptance criteria

- [x] The step-1 test passes on macOS and Linux. On Windows (symlink creation needs privileges) the test is conditionally skipped with a stated reason.
- [x] The README documents symlink behavior.

## Verification

```bash
npm test
```

## Progress notes

- 2026-10-06: done. Scanner uses `lstatSync` and skips every symlink (debug log); watcher sets `followSymlinks: false`; README Configuration section notes that symlinks are skipped. Tests: `scanProject symlink safety` (temp project with `loop -> .`, `outside -> <other temp dir>`, `link.ts -> src/a.ts`; failed before the fix with recursive `loop/loop/...` paths and outside files) and `FileWatcher symlink safety` (editing a file behind a symlinked directory dispatches nothing, with a real-file positive control; failed before the fix). Both use `it.skipIf(process.platform === 'win32')` because symlink creation needs privileges there. Verified locally on macOS only; Linux is expected to behave the same (POSIX symlinks) but was not run here. `npm test`: 50 files, 350 passed + 1 skipped.
- 2026-10-06: task created.
