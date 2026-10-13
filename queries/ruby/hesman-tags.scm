; Written for Hesman (MIT). Fills a gap of the upstream tags query
; (queries/ruby/tags.scm), which does not tag constants.

; `MAX_ITEMS = 100`
(assignment
  left: (constant) @name) @definition.constant
