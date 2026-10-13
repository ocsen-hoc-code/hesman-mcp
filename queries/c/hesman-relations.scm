; Written for Hesman (MIT). The upstream tags query tags no reference, so these
; are all the calls and imports of the language. Run by `TagsQuery.relations`
; (src/parsers/tags-engine.ts): `@name` is the callee (`@reference.call`) or
; the included path (`@reference.import`).

; `clamp(value)`; a function-like macro is invoked the same way
(call_expression
  function: (identifier) @name) @reference.call

; `ops->restock(item)`, `ops.restock(item)`
(call_expression
  function: (field_expression
    field: (field_identifier) @name)) @reference.call

; `#include "inventory.h"` (project headers; `<stdio.h>` is not a project file)
(preproc_include
  path: (string_literal (string_content) @name)) @reference.import
