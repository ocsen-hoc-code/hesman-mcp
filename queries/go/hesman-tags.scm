; Written for Hesman (MIT). Fills gaps of the upstream tags query
; (queries/go/tags.scm), which captures the names of constants and variables
; but does not tag them as definitions.

; `const Limit = 10`, every spec of a `const ( ... )` block, and every name of
; `const A, b = 1, 2`. The names are the only direct `identifier` children of a
; const_spec (values sit in an expression_list). The pattern does not use the
; `name:` field on purpose: with it, Tree-sitter reports only the first name of
; a multi-name const_spec.
(const_spec
  (identifier) @name) @definition.constant

; `var count = 0`, every spec of a `var ( ... )` block, and every name of
; `var x, y int`
(var_spec
  name: (identifier) @name) @definition.variable
