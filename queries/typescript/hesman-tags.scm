; Written for Hesman (MIT). Fills gaps of the upstream tags queries:
; queries/javascript/tags.scm and queries/typescript/tags.scm are listed first
; and win wherever they already tag a name (see src/parsers/tags-engine.ts).

; `type Id = string | number`
(type_alias_declaration
  name: (type_identifier) @name) @definition.type

; `enum Color { Red, Green }`
(enum_declaration
  name: (identifier) @name) @definition.enum

; `namespace Geometry { ... }` (upstream only tags `module Geometry { ... }`)
(internal_module
  name: (identifier) @name) @definition.namespace

; Methods the upstream query leaves out: `constructor`, `#private`,
; string-named and computed names.
(method_definition
  name: (_) @name) @definition.method

; `const limit = 10`, `let count`, `var legacy`. Upstream already tags a
; declarator whose value is a function as @definition.function; that wins.
(variable_declarator
  name: (identifier) @name) @definition.variable
