; Written for Hesman (MIT). Fills gaps of the upstream tags query
; (queries/csharp/tags.scm), which tags classes, interfaces, methods and
; namespaces with a simple name only.

; `public Item(string name) { ... }`
(constructor_declaration
  name: (identifier) @name) @definition.constructor

(enum_declaration
  name: (identifier) @name) @definition.enum

(struct_declaration
  name: (identifier) @name) @definition.struct

(record_declaration
  name: (identifier) @name) @definition.record

; `public string Name { get; }`
(property_declaration
  name: (identifier) @name) @definition.property

; `public const int MaxItems = 100;`, `private int _count;`
(field_declaration
  (variable_declaration
    (variable_declarator
      name: (identifier) @name))) @definition.field

; `namespace Fixtures.Inventory { ... }` and `namespace Fixtures.Inventory;`
(namespace_declaration
  name: (qualified_name) @name) @definition.module

(file_scoped_namespace_declaration
  name: (_) @name) @definition.module
