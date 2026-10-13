; Written for Hesman (MIT). The upstream tags query tags no reference, so these
; are all the calls of the language. Run by `TagsQuery.relations`
; (src/parsers/tags-engine.ts): `@name` is the callee.

; `normalize(name)`, `Item(name: "a")`
(call_expression
  . (simple_identifier) @name) @reference.call

; `item.restock(n)`, `self.record(event)`, `Util.clamp(n)`
(call_expression
  . (navigation_expression
    suffix: (navigation_suffix
      suffix: (simple_identifier) @name))) @reference.call
