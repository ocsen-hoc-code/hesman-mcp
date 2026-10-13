; Written for Hesman (MIT). Fills gaps of the upstream tags query
; (queries/javascript/tags.scm), which is listed first and wins wherever it
; already tags a name (see src/parsers/tags-engine.ts). The same two patterns
; are part of queries/typescript/hesman-tags.scm for TypeScript and TSX.

; Methods the upstream query leaves out: `constructor`, `#private`,
; string-named and computed names.
(method_definition
  name: (_) @name) @definition.method

; `const limit = 10`, `let count`, `var legacy`. Upstream already tags a
; declarator whose value is a function as @definition.function; that wins.
(variable_declarator
  name: (identifier) @name) @definition.variable
