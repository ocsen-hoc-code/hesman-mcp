/**
 * Languages whose grammar is downloaded on demand (M1-05, ADR 0001).
 *
 * They are the entries of `grammars.json` that are not bundled and have a
 * tags query. They are kept out of `LANGUAGES` (the bundled core set, which
 * the conformance suite and `hesman doctor` hold to a committed grammar):
 * `languages.ts` consults this catalog after its own registry.
 *
 * Such a language is known by id at all times, so a worker can load its
 * profile, but a *file* belongs to it only while the grammar is in the cache
 * (`availableOnDemandLanguage`). Until then the file is a text-tier file with
 * the same language label, which is why every extension listed here must be
 * labelled with the language id in `text-languages.ts`.
 *
 * All of them are `structural`: symbols from the upstream tags query, no
 * relation extraction. A manifest entry without a tags query would yield no
 * symbols at all, so its files stay on the text tier and it is not listed here.
 */
import { extname } from 'node:path';
import type { LanguageDefinition } from './languages.js';
import type { LanguageProfile } from './language-profile.js';
import { grammarStore, loadGrammarManifest, type GrammarManifest } from './grammar-store.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('grammars');

/**
 * Visibility is not modelled for on-demand languages (no per-language rule is
 * written for them): every definition the tags query finds counts as exported.
 */
const everythingExported = (): boolean => true;

function defineOnDemand(id: string, entry: GrammarManifest['grammars'][string]): LanguageDefinition {
  const extensions = entry.extensions ?? [];
  const profile: LanguageProfile = {
    language: id,
    extensions: [...extensions],
    // Where the grammar is cached. `core.ts` loads it through `grammarFileFor`, which hashes the file first.
    get parserWasmPath(): string {
      return grammarStore().cachePath(id);
    },
    isExported: everythingExported,
  };
  return {
    id,
    tier: 'structural',
    extensions,
    grammar: entry.file,
    tagsQuery: (entry.queries?.tags ?? []).map((path) => path.replace(/^queries\//, '')),
    profile,
  };
}

function loadOnDemandLanguages(): LanguageDefinition[] {
  let manifest: GrammarManifest;
  try {
    manifest = loadGrammarManifest();
  } catch (err) {
    // A broken installation still serves the bundled languages and the text tier.
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'grammars.json could not be read; no on-demand languages');
    return [];
  }
  return Object.entries(manifest.grammars)
    .filter(([, entry]) => !entry.bundled && entry.queries !== undefined && entry.extensions !== undefined)
    .map(([id, entry]) => defineOnDemand(id, entry));
}

/** Every on-demand language, in manifest order, whether or not its grammar is cached. */
export const ON_DEMAND_LANGUAGES: readonly LanguageDefinition[] = Object.freeze(loadOnDemandLanguages());

const BY_ID = new Map(ON_DEMAND_LANGUAGES.map((def) => [def.id, def]));
const BY_EXTENSION = new Map(ON_DEMAND_LANGUAGES.flatMap((def) => def.extensions.map((ext) => [ext.toLowerCase(), def] as const)));

/** The on-demand language with this id, cached or not. */
export function onDemandLanguageById(id: string): LanguageDefinition | undefined {
  return BY_ID.get(id);
}

/** The on-demand language of an extension (lowercase, leading dot), cached or not. */
export function onDemandLanguageForExtension(ext: string): LanguageDefinition | undefined {
  return BY_EXTENSION.get(ext);
}

/** The id of the on-demand language a path belongs to, cached or not; undefined for every other file. */
export function onDemandLanguageForPath(filePath: string): string | undefined {
  return BY_EXTENSION.get(extname(filePath).toLowerCase())?.id;
}

/** True when the grammar of an on-demand language is in the cache and matches its pinned hash. */
export function isOnDemandGrammarCached(id: string): boolean {
  return BY_ID.has(id) && grammarStore().availablePath(id) !== null;
}
