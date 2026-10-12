; Written for Hesman (MIT). tree-sitter-bash ships no tags query, so this is
; the whole query of the language.

; `name() { ... }` and `function name { ... }`
(function_definition
  name: (word) @name) @definition.function

; `readonly MAX_ATTEMPTS=3` at the top level of the script
(program
  (declaration_command
    "readonly"
    (variable_assignment
      name: (variable_name) @name)) @definition.constant)

; `export PATH=...`, `declare -a items=()` at the top level
(program
  (declaration_command
    (variable_assignment
      name: (variable_name) @name)) @definition.variable)

; `RELEASE_DIR=dist` at the top level
(program
  (variable_assignment
    name: (variable_name) @name) @definition.variable)

; `require_command curl`
(command
  name: (command_name
    (word) @name)) @reference.call
