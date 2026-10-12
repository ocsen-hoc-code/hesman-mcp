// Turns the `index_status` payload (the `index` field of `GET /api/status`) into what the
// overview shows. No DOM access.

import { formatCount } from './format.js';

/**
 * Support tier per language id: `deep` = symbols and calls, `structural` = symbols only.
 * `index_status` does not send the tier, so the table of src/parsers/languages.ts is repeated
 * here; a unit test fails when the two differ. A `tier` sent by the server wins.
 */
export const LANGUAGE_TIERS = {
  typescript: 'deep',
  tsx: 'deep',
  javascript: 'deep',
  python: 'deep',
  go: 'deep',
  java: 'deep',
  c: 'structural',
  cpp: 'structural',
  csharp: 'deep',
  rust: 'deep',
  php: 'deep',
  ruby: 'structural',
  kotlin: 'deep',
  swift: 'deep',
  bash: 'structural',
  lua: 'deep',
};

export const TIER_NOTES = {
  deep: 'Symbols and call relations',
  structural: 'Symbols only',
  text: 'Text chunks for search, no symbols',
  unknown: 'Tier not reported',
};

const list = (value) => (Array.isArray(value) ? value : []);

/** One row per language: grammar languages first, then the text tier. */
export function languageRows(index) {
  const parsed = list(index?.languages).map((row) => ({
    language: String(row.language),
    tier: typeof row.tier === 'string' ? row.tier : (LANGUAGE_TIERS[row.language] ?? 'unknown'),
    files: row.files ?? null,
    symbols: row.symbols ?? null,
    chunks: null,
  }));
  const text = list(index?.textTier?.languages).map((row) => ({
    language: String(row.language),
    tier: 'text',
    files: row.files ?? null,
    symbols: null,
    chunks: row.chunks ?? null,
  }));
  return [...parsed, ...text];
}

const PHASE_LABELS = {
  'resolving-root': 'Waiting for the project folder',
  'loading-model': 'Loading the embedding model',
  scanning: 'Scanning files',
  indexing: 'Indexing',
  resolving: 'Resolving relations',
};

/** `{ state, label, progress, detail }`; `progress` is 0..1 or null when it cannot be known. */
export function indexSummary(index) {
  const indexing = index?.indexing;
  if (!indexing || typeof indexing !== 'object') return { state: 'pending', label: 'Unknown', progress: null, detail: '' };
  if (indexing.phase === 'failed' || (indexing.error && !indexing.inProgress)) {
    return { state: 'error', label: 'Indexing failed', progress: null, detail: String(indexing.error ?? '') };
  }
  if (indexing.inProgress) {
    const known = indexing.filesTotal > 0;
    return {
      state: 'busy',
      label: PHASE_LABELS[indexing.phase] ?? 'Indexing',
      progress: known ? Math.min(1, indexing.filesDone / indexing.filesTotal) : null,
      detail: known ? `${formatCount(indexing.filesDone)} of ${formatCount(indexing.filesTotal)} files` : '',
    };
  }
  if ((index.totalFiles ?? 0) === 0 && (index.textTier?.files ?? 0) === 0) {
    return { state: 'warn', label: 'Nothing indexed yet', progress: null, detail: 'Start the Hesman MCP server in this project, or run `hesman index`.' };
  }
  return { state: 'ok', label: 'Index ready', progress: null, detail: '' };
}

export function healthRows(health) {
  if (!health || typeof health !== 'object') return [];
  const model = health.embeddingModelLoaded
    ? { state: 'ok', label: 'Loaded', detail: '' }
    : health.embeddingModelError
      ? { state: 'error', label: 'Failed to load', detail: String(health.embeddingModelError) }
      : { state: 'warn', label: 'Not loaded', detail: 'Semantic search is unavailable until the model loads.' };
  return [
    { name: 'Symbol database', ...(health.sqliteOk ? { state: 'ok', label: 'Working', detail: '' } : { state: 'error', label: 'Unavailable', detail: '' }) },
    {
      name: 'Vector store',
      ...(health.zvecOk
        ? { state: 'ok', label: 'Working', detail: `${formatCount(health.zvecDocCount ?? 0)} documents` }
        : { state: 'error', label: 'Unavailable', detail: 'Semantic search does not work without it.' }),
    },
    { name: 'Embedding model', ...model },
  ];
}
