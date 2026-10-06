/**
 * Language registry — the single source of truth for which languages Hesman
 * indexes, which file extensions map to them, and which profile parses them.
 *
 * Every module that needs a language table (scanner, coordinator, worker,
 * file watcher, tools) derives it from `LANGUAGES` through the helpers below.
 * Adding a language means adding one entry here plus its profile, WASM grammar
 * and tests — no other code changes.
 */
import { extname } from 'node:path';
import type { LanguageProfile, RelationQueries } from './language-profile.js';
import { tsProfile } from './profiles/typescript.js';
import { pythonProfile } from './profiles/python.js';
import { goProfile } from './profiles/go.js';

/** A registered language, described as data. */
export interface LanguageDefinition {
  /** Language id stored on every symbol ("typescript", "python", ...). */
  readonly id: string;
  /** File extensions (lowercase, with the leading dot) that map to this language. */
  readonly extensions: readonly string[];
  /** Tree-sitter WASM grammar file name inside the `parsers/` directory. */
  readonly grammar: string;
  /**
   * Optional Tree-sitter query files (paths relative to the `parsers/` directory),
   * keyed by relation kind. Reserved for M1: query-driven extraction.
   */
  readonly queries?: Readonly<Partial<Record<keyof RelationQueries, string>>>;
  /**
   * Extraction hooks (symbol node types, signature/doc-comment extraction,
   * relation queries). Languages with non-standard needs override behavior here.
   */
  readonly profile: LanguageProfile;
}

/** All registered languages. M0 ships TypeScript/JavaScript, Python and Go. */
export const LANGUAGES: readonly LanguageDefinition[] = Object.freeze([
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
    grammar: 'tree-sitter-typescript.wasm',
    profile: tsProfile,
  },
  {
    id: 'python',
    extensions: ['.py', '.pyw', '.pyi'],
    grammar: 'tree-sitter-python.wasm',
    profile: pythonProfile,
  },
  {
    id: 'go',
    extensions: ['.go'],
    grammar: 'tree-sitter-go.wasm',
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
