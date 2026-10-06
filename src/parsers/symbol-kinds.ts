/**
 * Symbol kinds that tools accept as filters. This mirrors the `kind` enum of
 * `find_symbol`, plus `constant` (emitted by the Go profile). `unknown` is
 * deliberately excluded: it is a fallback, not something to filter on.
 */
export const SYMBOL_KINDS = Object.freeze([
  'function',
  'class',
  'method',
  'variable',
  'interface',
  'type',
  'enum',
  'namespace',
  'constant',
] as const);

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

/** True if `kind` is one of the filterable symbol kinds. */
export function isSymbolKind(kind: string): kind is SymbolKind {
  return (SYMBOL_KINDS as readonly string[]).includes(kind);
}
