; Written for Hesman (MIT). Listed BEFORE the upstream query
; (queries/fsharp/tags.scm), so these patterns win for the names they tag.
;
; Why: upstream captures top-level functions and values with the @definition
; capture on the enclosing `file` / `named_module` / `module_defn` /
; `namespace`. Every function would therefore start on the first line of its
; module, span the whole module and take the module's signature. These
; patterns tag the `function_or_value_defn` itself, for the same four
; containers and with the kinds upstream uses.

(file
  (declaration_expression
    (function_or_value_defn
      (function_declaration_left
        . (_) @name)) @definition.function))

(named_module
  (declaration_expression
    (function_or_value_defn
      (function_declaration_left
        . (_) @name)) @definition.function))

(module_defn
  (declaration_expression
    (function_or_value_defn
      (function_declaration_left
        . (_) @name)) @definition.function))

(namespace
  (declaration_expression
    (function_or_value_defn
      (function_declaration_left
        . (_) @name)) @definition.function))

(file
  (declaration_expression
    (function_or_value_defn
      (value_declaration_left
        . (identifier_pattern
            (long_identifier_or_op
              (_) @name)))) @definition.constant))

(named_module
  (declaration_expression
    (function_or_value_defn
      (value_declaration_left
        . (identifier_pattern
            (long_identifier_or_op
              (_) @name)))) @definition.constant))

(module_defn
  (declaration_expression
    (function_or_value_defn
      (value_declaration_left
        . (identifier_pattern
            (long_identifier_or_op
              (_) @name)))) @definition.constant))

(namespace
  (declaration_expression
    (function_or_value_defn
      (value_declaration_left
        . (identifier_pattern
            (long_identifier_or_op
              (_) @name)))) @definition.constant))
