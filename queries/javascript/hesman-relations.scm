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

; The names an import binds (`@import.name`, replaced by `@import.alias` when
; there is one; `@import.module` for a name bound to the module itself). The
; call resolver uses them: a call of an imported name is only linked through
; that import.
; `import fs from './m'`
(import_statement
  (import_clause (identifier) @import.name)
  source: (string (string_fragment) @name)) @reference.import

; `import { join, resolve as abs } from './m'`
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (_) @import.name
        alias: (identifier)? @import.alias)))
  source: (string (string_fragment) @name)) @reference.import

; `import * as os from './m'`
(import_statement
  (import_clause (namespace_import (identifier) @import.module))
  source: (string (string_fragment) @name)) @reference.import

; `const path = require('./m')`, `const { clamp, scale: grow } = require('./m')`
(
  (variable_declarator
    name: (identifier) @import.name
    value: (call_expression
      function: (identifier) @_function
      arguments: (arguments . (string (string_fragment) @name)))) @reference.import
  (#eq? @_function "require")
)

(
  (variable_declarator
    name: (object_pattern
      [
        (shorthand_property_identifier_pattern) @import.name
        (pair_pattern value: (identifier) @import.name)
      ])
    value: (call_expression
      function: (identifier) @_function
      arguments: (arguments . (string (string_fragment) @name)))) @reference.import
  (#eq? @_function "require")
)

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
