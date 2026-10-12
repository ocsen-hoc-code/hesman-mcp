; Written for Hesman (MIT). Fills gaps of the upstream tags query
; (queries/java/tags.scm), which tags classes, interfaces and methods only.

; `public Inventory(int count) { ... }`
(constructor_declaration
  name: (identifier) @name) @definition.constructor

; `enum Status { ACTIVE, RETIRED }` and its constants
(enum_declaration
  name: (identifier) @name) @definition.enum

(enum_constant
  name: (identifier) @name) @definition.constant

; `record Point(int x, int y) { }`
(record_declaration
  name: (identifier) @name) @definition.record

; `@interface Marker { }`
(annotation_type_declaration
  name: (identifier) @name) @definition.interface

; `static final int MAX = 100;`, `private int count;` and every name of `int a, b;`
(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @definition.field
