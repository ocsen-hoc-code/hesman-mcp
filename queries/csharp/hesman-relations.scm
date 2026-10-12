; Written for Hesman (MIT). Calls and imports the upstream tags query does not
; tag. Run by `TagsQuery.relations` (src/parsers/tags-engine.ts): `@name` is the
; callee (`@reference.call`) or the module specifier (`@reference.import`).
; Upstream only tags `receiver.Method(...)` (as @reference.send).

; `Clamp(n)`, `Clamp<int>(n)`
(invocation_expression
  function: (identifier) @name) @reference.call

(invocation_expression
  function: (generic_name
    (identifier) @name)) @reference.call

; `receiver.Method<T>(...)`, `receiver?.Method(...)`
(invocation_expression
  function: (member_access_expression
    name: (generic_name
      (identifier) @name))) @reference.call

(invocation_expression
  function: (member_binding_expression
    name: (identifier) @name)) @reference.call

; `new Item(...)`, `new Box<int>(...)`, `new Ns.Item(...)`
(object_creation_expression
  type: (identifier) @name) @reference.call

(object_creation_expression
  type: (generic_name
    (identifier) @name)) @reference.call

(object_creation_expression
  type: (qualified_name
    name: (identifier) @name)) @reference.call
