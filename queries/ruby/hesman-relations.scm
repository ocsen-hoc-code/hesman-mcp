; Written for Hesman (MIT). Run by `TagsQuery.relations`
; (src/parsers/tags-engine.ts): `@name` is the callee (`@reference.call`) or
; the required path (`@reference.import`).
;
; Calls with a receiver, arguments or parentheses come from the upstream
; pattern `(call method: (identifier) @name)`. Upstream's second pattern (any
; identifier that is not a local variable) needs the `#is-not? local`
; predicate, which the runtime does not evaluate, so it is not used: a bare
; `helper` without arguments is not recorded as a call.

; `Item.new(1)`, `Inventory::Item.new(1)` also instantiate the class
(
  (call
    receiver: (constant) @name
    method: (identifier) @_method) @reference.call
  (#eq? @_method "new")
)

(
  (call
    receiver: (scope_resolution
      name: (constant) @name)
    method: (identifier) @_method) @reference.call
  (#eq? @_method "new")
)

; `require_relative 'util'`, `require 'json'`
(
  (call
    method: (identifier) @_method
    arguments: (argument_list . (string (string_content) @name))) @reference.import
  (#any-of? @_method "require" "require_relative")
)
