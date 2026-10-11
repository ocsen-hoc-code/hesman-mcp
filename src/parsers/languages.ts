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
import { tsProfile } from './profiles/typescript.js';
import { pythonProfile } from './profiles/python.js';
import { goProfile } from './profiles/go.js';

/**
 * Directory of the vendored Tree-sitter queries (`queries/` at the package
 * root, next to `parsers/`). Resolved from this module, so it is the same
 * directory when running from `src/` and from `dist/`.
 */
export const QUERIES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'queries');

/** A registered language, described as data. */
export interface LanguageDefinition {
  /** Language id stored on every symbol ("typescript", "python", ...). */
  readonly id: string;
  /** File extensions (lowercase, with the leading dot) that map to this language. */
  readonly extensions: readonly string[];
  /** Tree-sitter WASM grammar file name inside the `parsers/` directory. */
  readonly grammar: string;
  /**
   * Tags query files (`tags.scm` convention) that drive symbol extraction,
   * as paths relative to the `queries/` directory. A list is layered in order:
   * list the grammar's upstream queries first and Hesman's gap fillers
   * (`hesman-tags.scm`) last; when two layers tag the same name the earlier
   * one wins. Every file must be recorded in `queries/SOURCES.json` and
   * `NOTICE`. A language without a tags query is parsed but yields no symbols.
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

/** All registered languages. M0 ships TypeScript/JavaScript, Python and Go. */
export const LANGUAGES: readonly LanguageDefinition[] = Object.freeze([
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
    grammar: 'tree-sitter-typescript.wasm',
    // The TypeScript grammar extends the JavaScript grammar, and its upstream
    // tags query only adds the TypeScript-specific constructs.
    tagsQuery: ['javascript/tags.scm', 'typescript/tags.scm', 'typescript/hesman-tags.scm'],
    profile: tsProfile,
  },
  {
    id: 'python',
    extensions: ['.py', '.pyw', '.pyi'],
    grammar: 'tree-sitter-python.wasm',
    tagsQuery: 'python/tags.scm',
    profile: pythonProfile,
  },
  {
    id: 'go',
    extensions: ['.go'],
    grammar: 'tree-sitter-go.wasm',
    tagsQuery: ['go/tags.scm', 'go/hesman-tags.scm'],
    profile: goProfile,
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
