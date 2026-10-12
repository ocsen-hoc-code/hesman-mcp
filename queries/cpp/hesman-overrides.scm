; Written for Hesman (MIT). Listed BEFORE the upstream query
; (queries/cpp/tags.scm), so these patterns win for the names they tag.
;
; Why: upstream tags a function at its `function_declarator` (`clamp(int v)`),
; which excludes the return type, the body and the comment above it. The
; symbol would be one line long, with a truncated signature and no doc comment.
; These patterns tag the whole definition or declaration instead, with the
; kinds upstream uses. Anything they miss is still tagged by upstream.
;
; Each pattern comes twice: the declarator itself, and the declarator behind
; one `*` or `&` (`const std::string& name() const { ... }`).

; `int clamp(int value) { ... }`
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition.function

(function_definition
  declarator: (_
    (function_declarator
      declarator: (identifier) @name))) @definition.function

; Member functions defined inside the class
(function_definition
  declarator: (function_declarator
    declarator: (field_identifier) @name)) @definition.function

(function_definition
  declarator: (_
    (function_declarator
      declarator: (field_identifier) @name))) @definition.function

; `int Item::restock(int amount) { ... }`
(function_definition
  declarator: (function_declarator
    declarator: (qualified_identifier
      name: (identifier) @name))) @definition.method

(function_definition
  declarator: (_
    (function_declarator
      declarator: (qualified_identifier
      name: (identifier) @name)))) @definition.method

; Prototypes: `int clamp(int value);`
(declaration
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition.function

(declaration
  declarator: (_
    (function_declarator
      declarator: (identifier) @name))) @definition.function

; Member functions declared inside the class: `int restock(int amount) override;`
(field_declaration
  declarator: (function_declarator
    declarator: (field_identifier) @name)) @definition.function

(field_declaration
  declarator: (_
    (function_declarator
      declarator: (field_identifier) @name))) @definition.function
