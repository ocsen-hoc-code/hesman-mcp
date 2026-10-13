---
id: M1-10
title: Resolve the receiver of a member call before linking it
status: done
priority: P0
depends_on: [M1-09]
updated: 2026-10-13
---

## Context

After M1-09 a call with a receiver (`a.b()`) is linked by the method name alone, because the type of `a` is unknown. A project method whose name is also a method of a built-in or third-party object therefore collects calls that have nothing to do with it. Measured on this repository (schema 8): `ImportedFiles.has` 154 callers, `TagsQuery.delete` 53, `SqliteStore.open` and `SqliteStore.close` 43 each — almost all are `set.has(...)`, `map.delete(...)`, `db.close()` on other objects. This is the largest remaining source of false callers in `get_callers`, `get_references` and `impact_analysis`.

## Scope

1. **Infer what the receiver is, from the syntax tree and the file's own text, without a type checker.** At least, for the languages where it can be done from one file plus the imports:
   - the receiver is `this` / `self` / the class itself: the enclosing class (already done in M1-09);
   - the receiver is a local variable, parameter or field whose declaration in the same file names a type or a constructor: a type annotation (`x: Foo`, `Foo x`, `var x Foo`, `x *Foo`), `new Foo(...)`, `Foo(...)` / `Foo.new` / `Foo::new(...)` / `&Foo{...}`, a parameter type, a typed field of the enclosing class;
   - the receiver is an imported module or namespace (already done for bound imports in M1-09).
   Record the inferred type name on the call (a new nullable column is fine).
2. **Link by receiver type.** When the receiver type is known:
   - it names a project class/struct/interface/trait → the call may link only to a member of that type (or of a type it extends/implements where that relation is stored), with the visibility and import rules of M1-09;
   - it names something that is not in the project (a built-in such as `Map`, `Set`, `Array`, `string`, `dict`, `list`, a third-party type) → the call is external and stays unlinked.
3. **When the receiver type is unknown**, do not fall back to "unique in the project" for a member call: link only when the candidate method is in the caller's own file, in a file the caller imports, or in the caller's directory, and say in the docs that such a link is by name. Measure what this loses on this repository and report it; if correct links are lost in a pattern that can be recognised cheaply, recognise it.
4. Bump `INDEX_SCHEMA_VERSION` by one. Keep `getCallers` / `getCallees` / `getReferences` result shapes compatible.

## Out of scope

- Type inference across files or through function return types, generics, flow analysis.
- A compiler or language server.

## Acceptance criteria

- [x] Failing-first tests from minimal fixtures for: a typed receiver, a constructed receiver, a built-in receiver, an unknown receiver, in at least TypeScript, Python, Go, Java and Rust.
- [x] On this repository, calls on built-in objects are no longer linked to project methods: `ImportedFiles.has`, `TagsQuery.delete`, `SqliteStore.open` and `SqliteStore.close` keep only callers whose receiver is (or may be) that type; the report lists the before/after counts and 10 checked examples of removed links and 10 of kept links.
- [x] No correct link checked in the parity sample is lost without an explanation.
- [x] Conformance suite green for all 16 bundled languages; indexing benchmark at most 10% slower; index size on this repository reported.

## Verification

```bash
npm test && npm run test:conformance && npm run test:e2e && npm run test:perf
```

## Progress notes

- 2026-10-13: done (branch `worktree-agent-ad0889a52ac465c41`; commits `30f5bc3` (failing tests), `e430f01`, `315d1a4`, `2e65f47`, `cf5e578`, `7f2dea0`, `d4a12cd`, `c6bb1fe`, `6ad1bd7`; merged with `rebuild/m1-m2` in `3ed6cd7`). Index schema version 8 → 9.
  - **Type of the receiver** (`src/parsers/receiver-types.ts`, recorded as `relations.receiver_type`): read from the tree with the field names the grammars share (`name` / `pattern` / `left`, `type`, `value` / `right`, `declarator`, `constructor`, `function`, `operand`) for typed declarations, parameters (also untyped ones), constructor calls (`new T()`, `T()`, `T::new()`, `T{}`, `&T{}`), C-style and C# declarators, Kotlin parameters, `this.f` / `self.f` fields and their assignments; one walk per file, only for the receivers that calls use. Generic arguments, pointer and reference markers and `T | undefined` are removed; a type that is not a plain name (`Optional[T]`, `interface{}`, arrays, unions of two types) is not read. A capitalized name that no declaration of the file gives is recorded as its own type (`Vec::new()`), decided at link time.
  - **Not inferred:** types across files, through return values, generics and flow; Rust `self.field` (struct fields live in another block); Python `Optional[T]`; TypeScript utility types (`InstanceType<typeof X>`); lowercase names without a declaration (globals, fields reached without `this`).
  - **Link rules** (`resolveTypedMember` and `pickCallTarget` in `call-resolver.ts`, tests in `tests/integration/receiver-type-links.test.ts`): (1) a receiver an import binds keeps the import rule; (2) a type of the project (class, enum): the members of that type, then of its nearest supertype that declares the method (`supertypeNames`, same-file `extends` / `implements` only, as stored); a method of a type that is not a member is unlinked; (3) a name that is not in the project (`Map`, `dict`, `Set`, `Date`, `Client`) is external and unlinked; (4) a type that declares the method without a body (interface, abstract class; `declaresMember`) or an interface-like type links to the one member of that name in the project, never to several; (5) a receiver whose type is a function or a variable is unknown; (6) an unknown receiver links only in its own file, an imported file or its directory, or to a candidate that its name matches (module, class, namespace).
  - **Owner of a method** declared outside its type (`owner_type` on symbols): the receiver of a Go method, the `impl` block of a Rust method, the qualifier of a C++ definition (`void Item::f()`); such a method counts as a member of that type.
  - **Parity** (same snapshot of this repository at `HEAD`, 486 files, old binary `db72ebb` vs new): calls 24,908; linked 7,147 → 6,886 (removed 327, kept 6,818, retargeted 2, added 66). The four named methods, callers before → after: `ImportedFiles.has` 182 → 42, `TagsQuery.delete` 53 → 26, `SqliteStore.open` 49 → 69 (66 added links include 20 calls on values typed `SqliteStore` that were ambiguous before), `SqliteStore.close` 50 → 60. Removed by target: `ImportedFiles.has` 140 (`Set.has` on `flags`, `ids`, `directories`, `SELF_RECEIVERS`, …), `LogTee.write` 47 (`stdin.write`, `client.write`), `TagsQuery.delete` 27 (`Set`/`Map` `.delete`, web-tree-sitter `Query`/`Tree`/`Parser`), `callTool` 21 (MCP `Client`), `IndexState.update` 13 (`createHash().update`), `SqliteStore.close` 11 (`db.close()` on better-sqlite3, `readline`), `Retrier.run` 11 (`stmt.run`), `Item.init` 10 (`Parser.init()`), `RotatingFile.append` 10 (`svg.append`), `now` 5 (`Date.now`). No removed link has a receiver typed as its own target class, and no removed receiver has the name of its target class.
  - **Checked removed links** (read in the source): `flags.has('--force')` (a `Set`), `this.db.close()` (better-sqlite3), `stmt.run({...})` (a statement), `createHash('sha256').update(raw)` (a hash), `client.callTool(...)` (the MCP SDK client), `Date.now()`, `child.stdin.write(...)`, `svg.append(...)`, `Parser.init()`, `this.bindings.has(name)` (a `Map`). Ten are listed in the report.
  - **Checked kept links:** `store.open()` / `store.close()` typed `SqliteStore` (61 + 23); `files.has(...)` in `call-resolver.ts` (`files = importedFiles(...)`, a function returning `ImportedFiles`); `query.delete()` typed `TagsQuery`; `store.close()` in tests whose declaration is `SqliteStore | undefined` (linked through the import, now typed by the union rule).
  - **Lost correct link (explained):** `store.close()` at `tests/integration/text-tier-switch.test.ts:46` (`let store: InstanceType<typeof SqliteStore>`): the head name `InstanceType` is not a project type, so the call is external.
  - **Residual false links** (unknown receivers, linked by name in the own file or an imported file, as rule 6 allows): `server.close()` in `src/cli/commands.ts:199` (an awaited call's result), `tree.delete()` in `src/parsers/core.ts:162` and `query.delete()` in `src/parsers/tags-engine.ts:501` (a field chain, `this.definitionQuery?.query`), `imported.has(...)` in `call-resolver.ts:405` (an object-literal type). Two wrong links that an earlier walk kept (`Promise.resolve`) are unlinked after the walk was narrowed to declaring nodes.
  - **Performance:** `npm run test:perf` passes. The indexing benchmark (`parse + sqlite upsert (1 file)`) is within noise of the baseline: 4,112 → 4,149 files/s in one run and 2,832 → 2,746 in another, both with about 8% relative margin. Whole-repository `hesman index --no-semantic` 2.40–2.49 s before, 2.59–2.63 s after (about +8%, after pruning the walk from +12%). Index `symbols.db` of this repository 25.6 MB → 25.7 MB.
  - **Verification:** `npm run typecheck` clean; `npm run lint` 0 errors, 36 warnings (baseline 36); `npm test` 140 files, 2208 passed, 1 skipped (two runs); `npm run test:conformance` 258 passed; `npm run test:e2e` 110 passed; `npm run test:perf` passed.
