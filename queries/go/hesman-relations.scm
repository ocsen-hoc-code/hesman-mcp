; Written for Hesman (MIT). Imports; calls come from the upstream tags query.
; Run by `TagsQuery.relations` (src/parsers/tags-engine.ts): `@name` is the
; import path without its quotes.

; `import "example.com/m/util"`, also inside `import ( ... )` and with an alias
(import_spec
  path: (interpreted_string_literal
    (interpreted_string_literal_content) @name)) @reference.import

; `import u "example.com/m/util"`: the alias the package is used by. Without
; one the package is used by the last element of its path (call-resolver.ts).
(import_spec
  name: (package_identifier) @import.module
  path: (interpreted_string_literal
    (interpreted_string_literal_content) @name)) @reference.import
