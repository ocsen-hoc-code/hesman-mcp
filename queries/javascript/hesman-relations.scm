; Written for Hesman (MIT). Calls and imports the upstream tags query does not
; tag. Run by `TagsQuery.relations` (src/parsers/tags-engine.ts): `@name` is the
; callee (`@reference.call`) or the module specifier (`@reference.import`).
; Also a layer of typescript and tsx, whose grammars extend this one.

; `new X(...)`, `new ns.X(...)`: upstream tags the class as @reference.class only.
(new_expression
  constructor: (identifier) @name) @reference.call

(new_expression
  constructor: (member_expression
    property: (property_identifier) @name)) @reference.call

; `this.#secret()`
(call_expression
  function: (member_expression
    property: (private_property_identifier) @name)) @reference.call

; `import x from './m'`, `import './m'`, `export { x } from './m'`
(import_statement
  source: (string (string_fragment) @name)) @reference.import

(export_statement
  source: (string (string_fragment) @name)) @reference.import

; `require('./m')`, `await import('./m')`
(
  (call_expression
    function: (identifier) @_function
    arguments: (arguments . (string (string_fragment) @name))) @reference.import
  (#eq? @_function "require")
)

(call_expression
  function: (import)
  arguments: (arguments . (string (string_fragment) @name))) @reference.import
