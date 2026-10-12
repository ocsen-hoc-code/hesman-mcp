// Turns the `index_status` payload (the `index` field of `GET /api/status`) into what the
// overview shows. No DOM access.

import { formatCount } from './format.js';

/**
 * Support tier per language id: `deep` = symbols and calls, `structural` = symbols only.
 * `GET /api/status` sends the tier per language and that value wins. The table of
 * src/parsers/languages.ts is repeated here for a payload without it (mock data, an older
 * server); a unit test fails when the two differ.
 */
export const LANGUAGE_TIERS = {
  typescript: 'deep',
  tsx: 'deep',
  javascript: 'deep',
  python: 'deep',
  go: 'deep',
  java: 'deep',
  c: 'deep',
  cpp: 'deep',
  csharp: 'deep',
  rust: 'deep',
  php: 'deep',
  ruby: 'deep',
  kotlin: 'deep',
  swift: 'deep',
  bash: 'deep',
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

/**
 * @param semanticLimit the `semantic_search` entry of the status `limitations`, when the dashboard
 *   process does not open the vector store at all; that is then not a fault.
 */
export function healthRows(health, semanticLimit = null) {
  if (!health || typeof health !== 'object') return [];
  let model = { state: 'warn', label: 'Not loaded', detail: 'Semantic search is unavailable until the model loads.' };
  if (health.embeddingModelLoaded) model = { state: 'ok', label: 'Loaded', detail: '' };
  else if (health.embeddingModelError) model = { state: 'error', label: 'Failed to load', detail: String(health.embeddingModelError) };
  else if (semanticLimit) model = { state: 'pending', label: 'Not loaded here', detail: '' };
  let vectors = { state: 'error', label: 'Unavailable', detail: 'Semantic search does not work without it.' };
  if (health.zvecOk) vectors = { state: 'ok', label: 'Working', detail: `${formatCount(health.zvecDocCount ?? 0)} documents` };
  else if (semanticLimit) vectors = { state: 'pending', label: 'Not opened here', detail: String(semanticLimit.reason ?? '') };
  return [
    { name: 'Symbol database', ...(health.sqliteOk ? { state: 'ok', label: 'Working', detail: '' } : { state: 'error', label: 'Unavailable', detail: '' }) },
    { name: 'Vector store', ...vectors },
    { name: 'Embedding model', ...model },
  ];
}

const LIMITATION_NAMES = {
  semantic_search: 'Semantic search',
  indexing_progress: 'Live indexing progress',
  writes: 'Changes to the index',
};

/** What the dashboard process cannot do, from `limitations` of `GET /api/status`: `[{ feature, name, reason }]`. */
export function limitationRows(status) {
  return list(status?.limitations)
    .filter((row) => row && typeof row.feature === 'string')
    .map((row) => ({
      feature: row.feature,
      name: LIMITATION_NAMES[row.feature] ?? row.feature.replaceAll('_', ' '),
      reason: String(row.reason ?? ''),
    }));
}

export function limitationOf(status, feature) {
  return limitationRows(status).find((row) => row.feature === feature) ?? null;
}
