; Written for Hesman (MIT). Calls and imports the upstream tags query does not
; tag. Run by `TagsQuery.relations` (src/parsers/tags-engine.ts): `@name` is the
; callee (`@reference.call`) or the module specifier (`@reference.import`).
; Upstream tags `f()`, `x.f()` and `m!()`.

; `Item::new(n)`, `util::clamp(n)`
(call_expression
  function: (scoped_identifier
    name: (identifier) @name)) @reference.call

; `parse::<i32>(s)`, `Vec::<i32>::new()`, `x.get::<T>()`
(call_expression
  function: (generic_function
    function: (identifier) @name)) @reference.call

(call_expression
  function: (generic_function
    function: (scoped_identifier
      name: (identifier) @name))) @reference.call

(call_expression
  function: (generic_function
    function: (field_expression
      field: (field_identifier) @name))) @reference.call
