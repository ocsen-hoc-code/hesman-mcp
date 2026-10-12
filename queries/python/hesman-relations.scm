; Written for Hesman (MIT). Imports; calls come from the upstream tags query.
; Run by `TagsQuery.relations` (src/parsers/tags-engine.ts): `@name` is the
; module as written (`pkg.mod`, `.sibling`, `..`).

; `import pkg.mod`, `import pkg.mod as m`
(import_statement
  name: (dotted_name) @name) @reference.import

(import_statement
  name: (aliased_import
    name: (dotted_name) @name)) @reference.import

; `from pkg.mod import f`, `from .sibling import f`, `from . import sibling`
(import_from_statement
  module_name: (dotted_name) @name) @reference.import

(import_from_statement
  module_name: (relative_import) @name) @reference.import
