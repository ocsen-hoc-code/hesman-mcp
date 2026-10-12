; Written for Hesman (MIT). Listed BEFORE the upstream query
; (queries/c/tags.scm), so these patterns win for the names they tag.
;
; Why: upstream tags a function at its `function_declarator` (`clamp(int v)`),
; which excludes the return type, the body and the comment above it. The
; symbol would be one line long, with a truncated signature and no doc comment.
; These patterns tag the whole definition or declaration instead, with the kind
; upstream uses. Anything they miss is still tagged by upstream.

; `static int clamp(int value) { ... }`
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition.function

; `char *name(void) { ... }` and `char **names(void) { ... }`
(function_definition
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (identifier) @name))) @definition.function

(function_definition
  declarator: (pointer_declarator
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: (identifier) @name)))) @definition.function

; Prototypes: `int item_restock(item_t *item, int amount);`
(declaration
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition.function

(declaration
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (identifier) @name))) @definition.function

(declaration
  declarator: (pointer_declarator
    declarator: (pointer_declarator
      declarator: (function_declarator
        declarator: (identifier) @name)))) @definition.function
