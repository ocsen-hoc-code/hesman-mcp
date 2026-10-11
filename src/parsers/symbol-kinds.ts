/**
 * Symbol kinds that tools accept as filters (`find_symbol`, `semantic_search`).
 * `unknown` is deliberately excluded: it is a fallback, not something to filter on.
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

/** Kind given to a definition whose `tags.scm` capture suffix Hesman does not know. */
export const UNKNOWN_KIND = 'unknown';

/**
 * `tags.scm` capture suffix (`@definition.<suffix>`) → Hesman symbol kind.
 *
 * The first block is the convention shared by upstream grammars; the second
 * maps suffixes that some grammars use onto the closest Hesman kind, so a new
 * language needs no code. Anything else becomes `UNKNOWN_KIND`: the symbol is
 * still indexed and found by name, it just cannot be filtered by kind.
 */
const TAG_SUFFIX_KINDS: ReadonlyMap<string, SymbolKind> = new Map<string, SymbolKind>([
  ['function', 'function'],
  ['method', 'method'],
  ['class', 'class'],
  ['interface', 'interface'],
  ['type', 'type'],
  ['enum', 'enum'],
  ['constant', 'constant'],
  ['variable', 'variable'],
  ['namespace', 'namespace'],
  ['module', 'namespace'],

  ['macro', 'function'],
  ['constructor', 'method'],
  ['struct', 'class'],
  ['union', 'class'],
  ['object', 'class'],
  ['record', 'class'],
  ['trait', 'interface'],
  ['protocol', 'interface'],
  ['typedef', 'type'],
  ['alias', 'type'],
  ['field', 'variable'],
  ['property', 'variable'],
  ['package', 'namespace'],
]);

/** The Hesman kind for a `@definition.<suffix>` capture; `UNKNOWN_KIND` if the suffix is not mapped. */
export function kindForTagSuffix(suffix: string): SymbolKind | typeof UNKNOWN_KIND {
  return TAG_SUFFIX_KINDS.get(suffix) ?? UNKNOWN_KIND;
}
