; Written for Hesman (MIT). Fills gaps of the upstream tags query
; (queries/rust/tags.scm), which does not tag constants and statics.

; `pub const MAX_ITEMS: u32 = 100;`
(const_item
  name: (identifier) @name) @definition.constant

; `static DEFAULT_NAME: &str = "item";`
(static_item
  name: (identifier) @name) @definition.constant
