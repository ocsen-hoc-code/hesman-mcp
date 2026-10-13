; Written for Hesman (MIT). Listed BEFORE the upstream query
; (queries/swift/tags.scm), so these patterns win for the names they tag.
;
; Why: upstream captures the members of a type with the @definition capture on
; the enclosing `class_declaration` / `protocol_declaration`. Every method and
; property would therefore start on the line of its type, span the whole type
; and take the type's doc comment. These patterns tag the member itself, with
; the kinds upstream uses.

(class_body
  (function_declaration
    name: (simple_identifier) @name) @definition.method)

(class_body
  (init_declaration
    "init" @name) @definition.method)

(class_body
  (deinit_declaration
    "deinit" @name) @definition.method)

(enum_class_body
  (function_declaration
    name: (simple_identifier) @name) @definition.method)

(protocol_body
  (protocol_function_declaration
    name: (simple_identifier) @name) @definition.method)

(protocol_body
  (init_declaration
    "init" @name) @definition.method)

(class_body
  (property_declaration
    (pattern
      (simple_identifier) @name)) @definition.property)
