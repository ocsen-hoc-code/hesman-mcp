---
id: M1-09
title: Call-link precision and recovery from a corrupt index
status: done
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

- [x] Each of the four findings has a failing-first test built from a minimal fixture, not from this repository.
- [x] Parity run on this repository's `src/`, `tests/` and `scripts/`, before and after: number of `calls`, number linked, the 20 most-linked targets, and 10 checked examples of links removed and 10 of links kept; no checked example is a correct link that was lost, or each such loss is explained.
- [x] After the change no call in this repository is linked to `join` in `toml-codec.ts` from another file, and none to the variable `map`.
- [x] No `calls` relation has a non-function variable as its source.
- [x] `hesman index` on a project whose `symbols.db` is corrupt rebuilds the index and exits 0 (test through the real binary).
- [x] Conformance suite stays green for all 16 languages; indexing benchmark at most 10% slower.

## Verification

```bash
npm test && npm run test:conformance && npm run test:e2e && npm run test:perf
```

## Progress notes

- 2026-10-12: done (branch `worktree-agent-a6b14d4944c3501bc`, commits `323887d`, `2489363`, `1aaea08`, `092ecd1`, `d90e7da`, `e4f9059`, `ad9414b`, merged with `rebuild/m1-m2` in `a80952a`). Index schema version 7 → 8.
  - **Callers.** `TagsQuery.analyze` assigns each call the innermost enclosing definition that makes calls: a function, a method, a class (member initializers) or a variable whose value is a function, by byte range in the tree (the line-based `innermostSymbolAt` is gone). A call that none of them encloses is **kept** with the pseudo caller `module:<hash of the file path>`, which is not a symbol, in every language. Dropping it was the alternative; it was rejected because the call site is real and is what `get_references` and `impact_analysis` need from a test file or a script (`main "$@"`, `const app = createApp()`), and a made-up symbol per file would have changed symbol counts and every symbol tool. `get_callers` and the dashboard graph join symbols, so they do not show these call sites; `get_references` lists them with `callerName: null`.
  - **Receiver.** Each call records `relations.receiver`: null for `f()`, the receiver's last name for `a.f()` (`this`, `util`, `store` for `this.store.get()`, `super` for `super().m()`), `*` when it does not end in a name. Found generically: the closest named node before the callee name, inside the call, that is joined to it by a member operator (`.`, `?.`, `::`, `->`, `?->`, `&.`, `:`). One query fix: C# `a?.B()` was not extracted at all.
  - **Imported names.** `relations.names` on an import: the local names it binds, a module name prefixed with `*`. Captured by `@import.name` / `@import.alias` / `@import.module` in the Hesman relation layers of TypeScript/TSX/JavaScript (also `require`), Python and Go (a Go import without an alias is bound to the last element of its path). C/C++ includes and Ruby requires bind no names.
  - **Resolver** (`resolveCall` → `pickCallTarget`, rules documented there): (1) own file; (2) the import that binds the name, or the receiver when it is a module: only definitions reachable through that import, followed through re-exporting files (depth 3) and into the workspace package of that name (nearest `package.json`); nothing reachable → external, unresolved; (3) imported files → same directory → project, as before. Visibility per language (`CALL_REACH` in `sqlite.ts`): not exported → own file in TypeScript/TSX/JavaScript, Lua, Swift; files that include it in C/C++; the package directory in Go; unrestricted elsewhere (Rust crate visibility; Java/C#/Kotlin/PHP record `public` only; Python, Ruby, Bash have no enforced privacy). Member calls: a call with a receiver targets a method, a function declared in a class or interface (Kotlin and PHP tag methods as functions), a property function (`is_property`, now also a function listed in an object literal such as `return { run }` and a function declared as a member such as Lua `function M.f`), a class, or a function of the module/class/namespace the receiver names (`util::clamp`); never a free function or a variable. `this`/`self` first looks among the members of the caller's own class; `super` never does. A member that is not exported is linked when the calling file imports its file or shares its directory (an object travels), never through the project-wide tier.
  - **Corrupt index.** `SqliteStore.open` and `indexProject` catch `SQLITE_CORRUPT*` / `SQLITE_NOTADB`, move `symbols.db` (+ `-wal`, `-shm`) aside as `symbols.db.corrupt` and continue on an empty database; one warning line. Renamed, not deleted, so the file can be inspected; one generation is kept so repeated damage cannot fill the disk. The new database records `vector_schema_version = 0`, so the next run with the vector store clears and re-embeds. `hesman ui` is unchanged: it opens read-only and reports "not readable … run `hesman index`".
  - **Parity** (same tree at `cb92e2b`, `src/` + `tests/` + `scripts/`, old binary vs new): calls 9,669 → 22,964 (13,295 are module-level calls that were dropped or attributed to variables before); linked 5,200 → 6,614; kept 3,879, removed 1,282, retargeted 39, added 2,696 (2,595 from calls not recorded before). Sources before: variable 2,654, function 5,952, method 1,049, class 13, constant 1; after: module 15,957, function 5,943, method 1,049, class 15. Removed by target: `join` in `toml-codec.ts` 507, variable `map` 347, `trim` 52, variable `out` 48, variable `min` 42, `round` 32, variable `warn` 26, variable `get` 18, … (641 variables, 621 functions, 20 methods). 22 removed and 14 kept examples were read in the source: every removed one was a wrong link except the classes below; one kept link is wrong (`createHash(..).update(..)` → `IndexState.update`).
  - **Correct links lost, each explained:** `client.remove(...)` → `adapter.ts` (4): `remove` is now also a member of the codecs in the same directory, so the member call is ambiguous and stays unresolved (before, property functions were invisible to other files, which made it unique by accident). `tool.handler(...)` → `handler` in `semantic-search.ts` (5): the registered handler is a plain function passed by value, wrapped by `withArgValidation`; a member call is not linked to a free function. `ctx.onStatus(...)` → `main.js` (2) and `env.findOnPath(...)` from `doctor.ts` (1): members of an object literal that is not exported, called from a file that neither imports the defining file nor shares its directory.
  - **Remaining limits:** the receiver's type is not resolved, so a unique project method named like a built-in one still collects calls on other objects (here `ImportedFiles.has` 154, `TagsQuery.delete` 53, `SqliteStore.open`/`close` 43 each); requiring an import of the defining file would remove them but cannot work for the languages without import relations, so it is left for a task with type information. A bare call is still linked to an exported method of another file. Two calls of one name on one line by one caller are one row (primary key), so the second one's receiver wins. An aliased import (`import { a as b }`) is bound by its local name and does not link to `a`. Re-exports through a Python absolute import are not followed. A change to a re-exporting file does not re-resolve the calls that pass through it until the calling file changes. Python `super().__init__()` no longer links to the own `__init__`, but with an unknown parent it can link to another class's. Corruption that shows up inside the per-file error handling of an index run is reported as file errors, not repaired.
  - **Performance** (interleaved, same machine): `parse + sqlite upsert (1 file)` 3,850–4,009 files/s before, 3,890–3,988 after. `hesman index --no-semantic` on this repository 2.31–2.41 s before, 2.31–2.51 s after (a per-file index on `relations` and compiling the definitions-only query lazily pay for the extra rows). `symbols.db` of this repository 9.4 MB → 20.3 MB.
- 2026-10-12: task created from the dashboard check of M3 and a re-index of this repository after M1-07; started.
