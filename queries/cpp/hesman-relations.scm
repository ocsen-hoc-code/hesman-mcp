; Written for Hesman (MIT). The upstream tags query tags no reference, so these
; are all the calls and imports of the language. Run by `TagsQuery.relations`
; (src/parsers/tags-engine.ts): `@name` is the callee (`@reference.call`) or
; the included path (`@reference.import`).

; `clamp(value)`
(call_expression
  function: (identifier) @name) @reference.call

; `item->record(e)`, `item.record(e)`, `item.get<int>()`
(call_expression
  function: (field_expression
    field: (field_identifier) @name)) @reference.call

(call_expression
  function: (field_expression
    field: (template_method
      name: (field_identifier) @name))) @reference.call

; `make<Item>(2)`
(call_expression
  function: (template_function
    name: (identifier) @name)) @reference.call

; `util::clamp(v)`, `util::make<Item>(2)`, `ns::Item::create()`
(call_expression
  function: (qualified_identifier
    name: (identifier) @name)) @reference.call

(call_expression
  function: (qualified_identifier
    name: (template_function
      name: (identifier) @name))) @reference.call

(call_expression
  function: (qualified_identifier
    name: (qualified_identifier
      name: (identifier) @name))) @reference.call

(call_expression
  function: (qualified_identifier
    name: (qualified_identifier
      name: (qualified_identifier
        name: (identifier) @name)))) @reference.call

; `new Box(3)`, `new ns::Box(3)`, `new Box<int>(3)`
(new_expression
  type: (type_identifier) @name) @reference.call

(new_expression
  type: (qualified_identifier
    name: (type_identifier) @name)) @reference.call

(new_expression
  type: (template_type
    name: (type_identifier) @name)) @reference.call

; `#include "inventory.hpp"` (project headers; `<vector>` is not a project file)
(preproc_include
  path: (string_literal (string_content) @name)) @reference.import
