; Written for Hesman (MIT). Fills gaps of the upstream tags query
; (queries/cpp/tags.scm), which does not tag namespaces or preprocessor
; definitions.

; `namespace inventory { ... }`
(namespace_definition
  name: (namespace_identifier) @name) @definition.namespace

; `#define MAX_ITEMS 100` (an include guard has no value and is skipped)
(preproc_def
  name: (identifier) @name
  value: (_)) @definition.constant

(preproc_function_def
  name: (identifier) @name) @definition.macro
