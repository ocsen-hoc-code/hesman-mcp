; Written for Hesman (MIT). Fills gaps of the upstream tags query
; (queries/php/tags.scm), which does not tag constants and enums.

; `const MAX_ITEMS = 100;` at file level and inside a class
(const_declaration
  (const_element
    (name) @name)) @definition.constant

; `enum Status { case Active; }`
(enum_declaration
  name: (name) @name) @definition.enum
