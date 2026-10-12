/**
 * The note graph tools add when the language of the requested symbol has no
 * call extraction (M1-06). Without it an empty `get_callers` result for a
 * `structural` language reads as "nobody calls this".
 *
 * The note is a top-level `note` string of the tool payload: a plain field
 * passes through `compressToolResponse` whether or not the response is
 * compressed. It is absent for `deep` languages, so their responses do not grow.
 */
import type { SqliteStore } from '../stores/sqlite.js';
import { supportTier } from '../parsers/grammar-report.js';
import { textChunkIds } from '../parsers/text-chunker.js';

/** What the tool cannot answer: calls only, or every stored relation. */
export type TierNoteSubject = 'call graph' | 'references';

/** The text-tier label of the file a chunk id belongs to, or `undefined` when the id is no text chunk. */
function textChunkLanguage(store: SqliteStore, id: string): string | undefined {
  // Chunk ids are hashes of path + position, so they are rebuilt per file.
  // Only reached for an id that is not a symbol.
  for (const file of store.getTextFiles()) {
    if (textChunkIds(file.file_path, file.chunk_count).includes(id)) return file.language;
  }
  return undefined;
}

/**
 * @returns the note for `symbolId`, or `undefined` when its language is
 * `deep` or the id is neither a symbol nor a text chunk.
 */
export function tierNote(store: SqliteStore, symbolId: string, subject: TierNoteSubject): string | undefined {
  const symbol = store.getSymbolById(symbolId);
  if (symbol) {
    return supportTier(symbol.language) === 'deep'
      ? undefined
      : `${subject} not available for ${symbol.language} (symbols only)`;
  }
  const label = textChunkLanguage(store, symbolId);
  return label === undefined ? undefined : `${subject} not available for ${label} (text only, no symbols)`;
}

/** `{ note }` to spread into a tool payload, or `{}`. */
export function tierNoteField(store: SqliteStore, symbolId: string, subject: TierNoteSubject): { note?: string } {
  const note = tierNote(store, symbolId, subject);
  return note === undefined ? {} : { note };
}
