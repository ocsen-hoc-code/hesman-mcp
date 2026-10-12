; Written for Hesman (MIT). Calls and imports the upstream tags query does not
; tag. Run by `TagsQuery.relations` (src/parsers/tags-engine.ts): `@name` is the
; callee (`@reference.call`) or the module specifier (`@reference.import`).

; `clamp($n)`: the grammar parses a plain function name as (name); upstream
; only matches (qualified_name) and variables.
(function_call_expression
  function: (name) @name) @reference.call

; `new Item(...)`, `new \App\Item(...)`: upstream tags the class as @reference.class only.
(object_creation_expression
  (name) @name) @reference.call

(object_creation_expression
  (qualified_name
    (name) @name)) @reference.call

; `$item?->record()`
(nullsafe_member_call_expression
  name: (name) @name) @reference.call
