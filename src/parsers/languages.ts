/**
 * Language registry — the single source of truth for which languages Hesman
 * indexes, which file extensions map to them, and which profile parses them.
 *
 * Every module that needs a language table (scanner, coordinator, worker,
 * file watcher, tools) derives it from `LANGUAGES` through the helpers below.
 * Adding a language means adding one entry here plus its profile, WASM grammar
 * and tests — no other code changes.
 */
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LanguageProfile, RelationQueries } from './language-profile.js';
import { tsProfile, tsxProfile } from './profiles/typescript.js';
import { pythonProfile } from './profiles/python.js';
import { goProfile } from './profiles/go.js';
import {
  bashProfile,
  cProfile,
  cppProfile,
  csharpProfile,
  javaProfile,
  javascriptProfile,
  kotlinProfile,
  luaProfile,
  phpProfile,
  rubyProfile,
  rustProfile,
  swiftProfile,
} from './profiles/generic.js';

/**
 * Directory of the vendored Tree-sitter queries (`queries/` at the package
 * root, next to `parsers/`). Resolved from this module, so it is the same
 * directory when running from `src/` and from `dist/`.
 */
export const QUERIES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'queries');

/**
 * How deep Hesman's support for a parsed language goes:
 * - `deep`: symbols plus the call graph (calls, imports, impact analysis);
 * - `structural`: symbols only (definitions from the tags query).
 * Files without a grammar are the text tier and have no registry entry.
 */
export type LanguageTier = 'deep' | 'structural';

/** A registered language, described as data. */
export interface LanguageDefinition {
  /** Language id stored on every symbol ("typescript", "python", ...). */
  readonly id: string;
  /**
   * Support tier this entry promises. The conformance suite
   * (`tests/conformance/`) holds every entry to its tier: a `deep` language
   * must yield call relations for its fixtures.
   */
  readonly tier: LanguageTier;
  /** File extensions (lowercase, with the leading dot) that map to this language. */
  readonly extensions: readonly string[];
  /** Tree-sitter WASM grammar file name inside the `parsers/` directory. */
  readonly grammar: string;
  /**
   * Tags query files (`tags.scm` convention) that drive symbol extraction,
   * as paths relative to the `queries/` directory. A list is layered in order
   * and when two layers tag the same name the earlier one wins: list the
   * grammar's upstream queries first and Hesman's gap fillers
   * (`hesman-tags.scm`) last, so they only add definitions. A
   * `hesman-overrides.scm` layer is listed *before* upstream, for the rare
   * pattern whose upstream definition node is wrong (the file states why).
   * Every file must be recorded in `queries/SOURCES.json` and `NOTICE`. A
   * language without a tags query is parsed but yields no symbols.
   */
  readonly tagsQuery?: string | readonly string[];
  /**
   * Optional Tree-sitter query files (paths relative to the `parsers/` directory),
   * keyed by relation kind. Reserved for M1: query-driven extraction.
   */
  readonly queries?: Readonly<Partial<Record<keyof RelationQueries, string>>>;
  /**
   * Grammar path, export rules, relation queries and the documented override
   * hooks for what a tags query cannot express.
   */
  readonly profile: LanguageProfile;
}

/** Layers shared by TypeScript and TSX: both grammars extend the JavaScript grammar. */
const TS_TAGS = [
  'javascript/tags.scm',
  'typescript/tags.scm',
  'typescript/hesman-tags.scm',
  'javascript/hesman-relations.scm',
] as const;

/**
 * All registered languages: the bundled core set of ADR 0001 (section 10).
 * Their grammars ship in `parsers/`; every other file is indexed by the text
 * tier (`text-languages.ts`).
 *
 * `tier` is `deep` only where the regex call extractor finds every call
 * between the definitions of the language's conformance fixture and reports no
 * false self-call; the reason for each `structural` entry is next to it.
 */
export const LANGUAGES: readonly LanguageDefinition[] = Object.freeze([
  {
    id: 'typescript',
    tier: 'deep',
    extensions: ['.ts', '.mts', '.cts'],
    grammar: 'tree-sitter-typescript.wasm',
    // The upstream TypeScript tags query only adds the TypeScript-specific constructs.
    tagsQuery: TS_TAGS,
    profile: tsProfile,
  },
  {
    // Same repository and tag as the TypeScript grammar, plus the JSX rules.
    id: 'tsx',
    tier: 'deep',
    extensions: ['.tsx'],
    grammar: 'tree-sitter-tsx.wasm',
    tagsQuery: TS_TAGS,
    profile: tsxProfile,
  },
  {
    // Also parses JSX.
    id: 'javascript',
    tier: 'deep',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    grammar: 'tree-sitter-javascript.wasm',
    tagsQuery: ['javascript/tags.scm', 'javascript/hesman-tags.scm', 'javascript/hesman-relations.scm'],
    profile: javascriptProfile,
  },
  {
    id: 'python',
    tier: 'deep',
    extensions: ['.py', '.pyw', '.pyi'],
    grammar: 'tree-sitter-python.wasm',
    tagsQuery: ['python/tags.scm', 'python/hesman-tags.scm', 'python/hesman-relations.scm'],
    profile: pythonProfile,
  },
  {
    id: 'go',
    tier: 'deep',
    extensions: ['.go'],
    grammar: 'tree-sitter-go.wasm',
    tagsQuery: ['go/tags.scm', 'go/hesman-tags.scm', 'go/hesman-relations.scm'],
    profile: goProfile,
  },
  {
    id: 'java',
    tier: 'deep',
    extensions: ['.java'],
    grammar: 'tree-sitter-java.wasm',
    tagsQuery: ['java/tags.scm', 'java/hesman-tags.scm', 'java/hesman-relations.scm'],
    profile: javaProfile,
  },
  {
    id: 'c',
    tier: 'deep',
    extensions: ['.c', '.h'],
    grammar: 'tree-sitter-c.wasm',
    tagsQuery: ['c/hesman-overrides.scm', 'c/tags.scm', 'c/hesman-tags.scm', 'c/hesman-relations.scm'],
    profile: cProfile,
  },
  {
    id: 'cpp',
    tier: 'deep',
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.ipp', '.tpp'],
    grammar: 'tree-sitter-cpp.wasm',
    tagsQuery: ['cpp/hesman-overrides.scm', 'cpp/tags.scm', 'cpp/hesman-tags.scm', 'cpp/hesman-relations.scm'],
    profile: cppProfile,
  },
  {
    id: 'csharp',
    tier: 'deep',
    extensions: ['.cs', '.csx'],
    grammar: 'tree-sitter-c_sharp.wasm',
    tagsQuery: ['csharp/tags.scm', 'csharp/hesman-tags.scm', 'csharp/hesman-relations.scm'],
    profile: csharpProfile,
  },
  {
    id: 'rust',
    tier: 'deep',
    extensions: ['.rs'],
    grammar: 'tree-sitter-rust.wasm',
    tagsQuery: ['rust/tags.scm', 'rust/hesman-tags.scm', 'rust/hesman-relations.scm'],
    profile: rustProfile,
  },
  {
    id: 'php',
    tier: 'deep',
    extensions: ['.php', '.phtml'],
    grammar: 'tree-sitter-php.wasm',
    tagsQuery: ['php/tags.scm', 'php/hesman-tags.scm', 'php/hesman-relations.scm'],
    profile: phpProfile,
  },
  {
    id: 'ruby',
    tier: 'deep',
    extensions: ['.rb', '.rake', '.gemspec', '.ru', '.podspec'],
    grammar: 'tree-sitter-ruby.wasm',
    tagsQuery: ['ruby/tags.scm', 'ruby/hesman-tags.scm', 'ruby/hesman-relations.scm'],
    profile: rubyProfile,
  },
  {
    // fwcd/tree-sitter-kotlin (ADR 0001, section 10); the other Kotlin grammar needs another query.
    id: 'kotlin',
    tier: 'deep',
    extensions: ['.kt', '.kts'],
    grammar: 'tree-sitter-kotlin.wasm',
    tagsQuery: 'kotlin/tags.scm',
    profile: kotlinProfile,
  },
  {
    id: 'swift',
    tier: 'deep',
    extensions: ['.swift'],
    grammar: 'tree-sitter-swift.wasm',
    tagsQuery: ['swift/hesman-overrides.scm', 'swift/tags.scm', 'swift/hesman-relations.scm'],
    profile: swiftProfile,
  },
  {
    // No tags query upstream: the query is written for Hesman.
    id: 'bash',
    tier: 'deep',
    extensions: ['.sh', '.bash'],
    grammar: 'tree-sitter-bash.wasm',
    tagsQuery: 'bash/hesman-tags.scm',
    profile: bashProfile,
  },
  {
    id: 'lua',
    tier: 'deep',
    extensions: ['.lua'],
    grammar: 'tree-sitter-lua.wasm',
    tagsQuery: 'lua/tags.scm',
    profile: luaProfile,
  },
]);

const BY_ID = new Map<string, LanguageDefinition>();
const BY_EXTENSION = new Map<string, LanguageDefinition>();

for (const def of LANGUAGES) {
  if (BY_ID.has(def.id)) {
    throw new Error(`Duplicate language id in registry: ${def.id}`);
  }
  if (def.profile.language !== def.id) {
    throw new Error(`Profile language "${def.profile.language}" does not match registry id "${def.id}"`);
  }
  BY_ID.set(def.id, def);
  for (const ext of def.extensions) {
    const key = ext.toLowerCase();
    const existing = BY_EXTENSION.get(key);
    if (existing) {
      throw new Error(`Extension ${ext} registered for both ${existing.id} and ${def.id}`);
    }
    BY_EXTENSION.set(key, def);
  }
}

/** Ids of every registered language, in registry order. */
export const LANGUAGE_IDS: readonly string[] = Object.freeze(LANGUAGES.map((l) => l.id));

/** True if `id` is a registered language id. */
export function isLanguageId(id: string): boolean {
  return BY_ID.has(id);
}

/** The registry entry for a language id, or undefined. */
export function languageById(id: string): LanguageDefinition | undefined {
  return BY_ID.get(id);
}

/** Absolute paths of a language's tags query files, in layer order (empty if it has none). */
export function tagsQueryFiles(def: LanguageDefinition): string[] {
  if (def.tagsQuery === undefined) return [];
  const relative = typeof def.tagsQuery === 'string' ? [def.tagsQuery] : def.tagsQuery;
  return relative.map((path) => join(QUERIES_DIR, path));
}

/** The parsing profile for a language id, or undefined if the language is not registered. */
export function profileFor(id: string): LanguageProfile | undefined {
  return BY_ID.get(id)?.profile;
}

/** The registry entry for a file extension (with or without the leading dot), or undefined. */
export function languageForExtension(ext: string): LanguageDefinition | undefined {
  const normalized = (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase();
  return BY_EXTENSION.get(normalized);
}

/** The language id for a file path, based on its extension, or undefined if unsupported. */
export function languageForPath(filePath: string): string | undefined {
  const ext = extname(filePath);
  if (!ext) return undefined;
  return languageForExtension(ext)?.id;
}
