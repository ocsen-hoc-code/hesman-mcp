; Written for Hesman (MIT). Calls and imports the upstream tags query does not
; tag. Run by `TagsQuery.relations` (src/parsers/tags-engine.ts): `@name` is the
; callee (`@reference.call`) or the module specifier (`@reference.import`).

; `new Item(...)`, `new ArrayList<>()`, `new pkg.Item(...)`: upstream tags the
; plain form as @reference.class only.
(object_creation_expression
  type: (type_identifier) @name) @reference.call

(object_creation_expression
  type: (generic_type
    (type_identifier) @name)) @reference.call

(object_creation_expression
  type: (scoped_type_identifier
    (type_identifier) @name .)) @reference.call
