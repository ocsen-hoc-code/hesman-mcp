; Written for Hesman (MIT). Fills gaps of the upstream tags query
; (queries/c/tags.scm), which does not tag preprocessor definitions.

; `#define MAX_ITEMS 100` (an include guard, `#define FOO_H`, has no value and is skipped)
(preproc_def
  name: (identifier) @name
  value: (_)) @definition.constant

; `#define MIN(a, b) ((a) < (b) ? (a) : (b))`
(preproc_function_def
  name: (identifier) @name) @definition.macro
