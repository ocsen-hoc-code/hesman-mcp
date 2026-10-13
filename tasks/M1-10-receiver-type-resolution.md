---
id: M1-10
title: Resolve the receiver of a member call before linking it
status: pending
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

- [ ] Failing-first tests from minimal fixtures for: a typed receiver, a constructed receiver, a built-in receiver, an unknown receiver, in at least TypeScript, Python, Go, Java and Rust.
- [ ] On this repository, calls on built-in objects are no longer linked to project methods: `ImportedFiles.has`, `TagsQuery.delete`, `SqliteStore.open` and `SqliteStore.close` keep only callers whose receiver is (or may be) that type; the report lists the before/after counts and 10 checked examples of removed links and 10 of kept links.
- [ ] No correct link checked in the parity sample is lost without an explanation.
- [ ] Conformance suite green for all 16 bundled languages; indexing benchmark at most 10% slower; index size on this repository reported.

## Verification

```bash
npm test && npm run test:conformance && npm run test:e2e && npm run test:perf
```

## Progress notes

- 2026-10-13: task created from the remaining limits of M1-09; started.
