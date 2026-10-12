---
id: M1-09
title: Call-link precision and recovery from a corrupt index
status: pending
priority: P0
depends_on: [M1-07]
updated: 2026-10-12
---

## Context

After M1-07 the call graph is read from the syntax tree, but indexing Hesman's own repository (2026-10-12, schema 7) still shows wrong links and wrong callers. They make `get_callers`, `get_references` and `impact_analysis` report callers that do not exist, which is worse than reporting none.

Measured on this repository:

1. **A name imported from outside the project is linked to an unrelated project symbol.** 512 calls of `join(...)` — imported from `node:path` in the calling files — are linked to `const join` in `src/cli/clients/toml-codec.ts`, a module-private helper that no other file can reach. The project-wide tier of `call-resolver.ts` accepts it because the name is unique in the project.
2. **A member call is linked to a symbol of the same name.** 347 `.map(` calls are linked to a variable named `map` in `src/ui/public/js/lib/graph-model.js`; `.push(`, `.get(`, `.filter(`, `.set(` behave the same.
3. **A module-level constant is recorded as the caller.** 2,295 `calls` relations have a non-function variable as their source, e.g. `const ROOT = fileURLToPath(new URL(...))` records `ROOT -> fileURLToPath`; in tests `const result = await indexProject(...)` records `result -> indexProject`, so the dashboard lists `result` under "Called by".
4. **`hesman index` aborts on a corrupt index.** With a damaged `symbols.db` (seen with an old v1.0 file: `SqliteError: database disk image is malformed`, `SQLITE_CORRUPT_VTAB`, thrown from `SqliteStore.clearIndex` during the schema reset) the command exits with a fatal error instead of rebuilding the index, which is derived data.

## Scope

1. **Visibility.** A symbol that cannot be reached from another file is never a cross-file call target: for languages with a file/module-private default (TypeScript, TSX, JavaScript, Python by convention is out of scope, Go lower-case within the same package stays reachable, Rust without `pub` within the crate stays reachable — define the rule per language from `isExported` and document it). The same-file tier is unaffected.
2. **Imports win.** When the calling file imports the called name from a module that does not resolve to a project file (a package or built-in such as `node:path`), the call is external: it is not linked by the same-directory or project-wide tier. When the import resolves to a project file, only that file's definition is a candidate. This needs the imported names (not only the module specifier) from the tree for the languages that have import relations.
3. **Member calls.** A call with a receiver (`a.b()`, `a?.b()`, `a::b()`, `a->b()`) is linked only to a method or to a function stored as a property (`is_property`), never to a free function or a variable through the same-directory or project-wide tier. `this.b()` / `self.b()` stay linkable to a method of the enclosing class. Define the rule once in the resolver and record the receiver flag at extraction.
4. **Callers.** The source of a `calls` relation is a function, a method, a class member initializer's class, or a variable whose value is a function. A call in the initializer of another variable or at module level is attributed to the enclosing function if there is one; otherwise decide between dropping it and attributing it to a module-level pseudo caller, justify the choice, and apply it in every language.
5. **Corrupt index.** Opening or resetting an index that SQLite reports as corrupt renames the damaged files aside (or removes them — justify) and rebuilds, with one clear log line; the vector store of that index is rebuilt with it. Applies to the MCP server startup and `hesman index`. `hesman ui` stays read-only and reports the problem.
6. Bump `INDEX_SCHEMA_VERSION` by one.

## Out of scope

- Type resolution (which class a receiver has).
- New languages or new import relations beyond what item 2 needs.

## Acceptance criteria

- [ ] Each of the four findings has a failing-first test built from a minimal fixture, not from this repository.
- [ ] Parity run on this repository's `src/`, `tests/` and `scripts/`, before and after: number of `calls`, number linked, the 20 most-linked targets, and 10 checked examples of links removed and 10 of links kept; no checked example is a correct link that was lost, or each such loss is explained.
- [ ] After the change no call in this repository is linked to `join` in `toml-codec.ts` from another file, and none to the variable `map`.
- [ ] No `calls` relation has a non-function variable as its source.
- [ ] `hesman index` on a project whose `symbols.db` is corrupt rebuilds the index and exits 0 (test through the real binary).
- [ ] Conformance suite stays green for all 16 languages; indexing benchmark at most 10% slower.

## Verification

```bash
npm test && npm run test:conformance && npm run test:e2e && npm run test:perf
```

## Progress notes

- 2026-10-12: task created from the dashboard check of M3 and a re-index of this repository after M1-07; started.
