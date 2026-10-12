/**
 * What `index_status` says about grammars (M1-05): for every language that
 * has files in the index, whether its files are parsed or on the text tier,
 * and whether its grammar is bundled, cached or missing (and why).
 */
import { grammarStore, type GrammarStore } from './grammar-store.js';
import { languageById } from './languages.js';

/**
 * Why a language's files are on the text tier, or what is about to change:
 * - `offline`, `downloading`, `download-failed`, `not-downloaded`: state of an on-demand grammar;
 * - `reindex-pending`: the grammar is cached, the files are parsed by the next indexing pass;
 * - `no-tags-query`: the catalog pins a grammar, but there is no tags query for it, so it yields no symbols;
 * - `not-in-catalog`: Hesman knows no grammar for this language.
 */
export type GrammarReason =
  | 'offline'
  | 'downloading'
  | 'download-failed'
  | 'not-downloaded'
  | 'reindex-pending'
  | 'no-tags-query'
  | 'not-in-catalog';

export interface LanguageGrammarStatus {
  language: string;
  /** How the language's files are stored in the index now. */
  tier: 'parsed' | 'text';
  files: number;
  grammar: 'bundled' | 'cached' | 'missing';
  reason?: GrammarReason;
  /** The error of a failed download. */
  detail?: string;
}

export interface GrammarReport {
  /** True when grammar downloads are disabled. */
  offline: boolean;
  /** Directory of the downloaded grammars. */
  cacheDir: string;
  languages: LanguageGrammarStatus[];
}

interface LanguageFiles {
  language: string;
  files: number;
}

function textTierStatus(language: string, files: number, store: GrammarStore): LanguageGrammarStatus {
  const base = { language, tier: 'text' as const, files };
  const entry = store.entry(language);
  if (!entry) return { ...base, grammar: 'missing', reason: 'not-in-catalog' };
  const status = store.status(language);
  const grammar = status.state === 'missing' ? 'missing' : status.state;
  if (!languageById(language)) return { ...base, grammar, reason: 'no-tags-query' };
  if (status.state !== 'missing') return { ...base, grammar, reason: 'reindex-pending' };
  return { ...base, grammar, reason: status.reason, ...(status.detail ? { detail: status.detail } : {}) };
}

/**
 * @param parsed - languages with symbols in the index (`SqliteStore.getLanguageStats`)
 * @param text - languages of the text tier (`SqliteStore.getTextLanguageStats`)
 */
export function grammarReport(
  parsed: readonly LanguageFiles[],
  text: readonly LanguageFiles[],
  store: GrammarStore = grammarStore(),
): GrammarReport {
  return {
    offline: store.offline,
    cacheDir: store.cacheDir,
    languages: [
      ...parsed.map(({ language, files }): LanguageGrammarStatus => ({
        language,
        tier: 'parsed',
        files,
        grammar: store.entry(language)?.bundled === false ? 'cached' : 'bundled',
      })),
      ...text.map(({ language, files }) => textTierStatus(language, files, store)),
    ],
  };
}
