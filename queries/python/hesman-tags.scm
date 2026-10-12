; Written for Hesman (MIT). Fills a gap of the upstream tags query
; (queries/python/tags.scm), which only tags `NAME = value` at module level.

; Every name of a module-level tuple assignment: `LOW, HIGH = 5, 50` and
; `(LEFT, RIGHT) = 1, 2`. Only plain names are tagged (not `a.b, c[0] = ...`).
(module
  (expression_statement
    (assignment
      left: [
        (pattern_list (identifier) @name)
        (tuple_pattern (identifier) @name)
      ]) @definition.constant))
