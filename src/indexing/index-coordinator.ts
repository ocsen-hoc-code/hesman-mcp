import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chunkSymbols } from '../parsers/chunker.js';
import { embedBatch } from '../stores/embedding.js';
import type { ZVecStore } from '../stores/zvec.js';
import { createLogger } from '../utils/logger.js';
import type { HesmanConfig } from '../config/schema.js';
import { INDEX_SCHEMA_VERSION, type SqliteStore } from '../stores/sqlite.js';
import { scanProject, type ScannedFile } from './project-scanner.js';
import { indexTextFile, storedTextChunkIds } from './text-indexer.js';
import { parseFile, initParser, type ExtractedSymbol } from '../parsers/core.js';
import { extractRelations } from '../parsers/relation-extractor.js';
import { profileFor } from '../parsers/languages.js';
import { WorkerPool, WorkerTask } from './worker-pool.js';
import { resolveCallRelations, type CallResolutionScope } from './call-resolver.js';
import type { IndexProgress, IndexRunPhase } from './index-state.js';

const log = createLogger('index-coordinator');

export interface IndexResult {
  filesScanned: number;
  filesIndexed: number;
  symbolsFound: number;
  errors: string[];
  tookMs: number;
}

export interface IndexOptions {
  /** Called on every phase change and after each file is handled. */
  onProgress?: (progress: IndexProgress) => void;
  /** Aborting makes the run reject with `IndexAbortedError` at its next step. */
  signal?: AbortSignal;
}

/** Thrown by `indexProject` when its `signal` aborts (e.g. server shutdown mid-index). */
export class IndexAbortedError extends Error {
  constructor() {
    super('Indexing aborted');
    this.name = 'IndexAbortedError';
  }
}

/**
 * Files per worker-pool dispatch. Results are stored after each chunk, so
 * progress advances steadily and queries see partial results early instead of
 * nothing until every file is parsed.
 */
const PARSE_CHUNK_SIZE = 64;

/**
 * Longest stretch of synchronous work before yielding to the event loop. The
 * server indexes in the background, so MCP requests must get a turn while
 * thousands of files are hashed and written.
 */
const YIELD_INTERVAL_MS = 20;

/**
 * Ids of the vector documents currently stored for `filePath`: its symbols
 * and, if the file was indexed by the text tier before, its text chunks.
 */
function vectorIdsOf(store: SqliteStore, filePath: string): string[] {
  return [...store.getSymbolsByFile(filePath).map((s) => s.id), ...storedTextChunkIds(store, filePath)];
}

function sha256Of(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Records a file about to be replaced in the store: its own calls and every
 * call to one of its current (soon removed) symbol names must be re-resolved.
 */
function noteReplacedFile(scope: CallResolutionScope, store: SqliteStore, filePath: string): void {
  scope.files.push(filePath);
  for (const s of store.getSymbolsByFile(filePath)) scope.names.push(s.name);
}

/**
 * An index written by an older schema holds values with a different meaning
 * (e.g. 0-based lines before M0-14). File hashes would make the incremental
 * run skip those files, so clear everything and rebuild from scratch.
 *
 * The ZVec documents carry their own version: a run without ZVec (CLI `index`,
 * `--no-semantic`) cannot clear them, so it records that they are still old and
 * the first ZVec-enabled run clears and re-embeds everything.
 */
function resetOutdatedIndex(store: SqliteStore, zvecStore?: ZVecStore): void {
  const version = store.getIndexSchemaVersion();
  const vectorVersion = store.getVectorSchemaVersion() ?? version;
  const vectorsOutdated = zvecStore !== undefined && vectorVersion < INDEX_SCHEMA_VERSION;
  if (version >= INDEX_SCHEMA_VERSION && !vectorsOutdated) return;
  log.info(
    { from: version, vectorsFrom: vectorVersion, to: INDEX_SCHEMA_VERSION },
    'Index schema is outdated — forcing a full re-index',
  );
  // Vectors are only written for stored symbols: an empty index (new data dir)
  // has none to go stale.
  const stats = store.getStats();
  const hadData = stats.totalSymbols > 0 || stats.lastIndexTime !== null;
  zvecStore?.clear();
  store.clearIndex();
  store.setIndexSchemaVersion(INDEX_SCHEMA_VERSION);
  store.setVectorSchemaVersion(zvecStore || !hadData ? INDEX_SCHEMA_VERSION : vectorVersion);
}

export async function indexProject(
  rootDir: string,
  store: SqliteStore,
  config: HesmanConfig,
  zvecStore?: ZVecStore,
  pool?: WorkerPool,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const { onProgress, signal } = options;

  let filesDone = 0;
  let filesTotal = 0;
  const report = (phase: IndexRunPhase): void => onProgress?.({ phase, filesDone, filesTotal });
  const callScope: CallResolutionScope = { files: [], names: [] };
  /**
   * Links calls to their targets (callees may live in files indexed later in
   * the batch, so this runs once every changed file is in the store).
   */
  const resolveStoredCalls = (): void => {
    if (callScope.files.length === 0) return;
    try {
      resolveCallRelations(store, callScope);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ error: message }, 'Failed to resolve call relations');
      errors.push(`call resolution: ${message}`);
    }
  };
  const throwIfAborted = (): void => {
    if (!signal?.aborted) return;
    // Files stored so far keep their hash and are skipped by the next run, so
    // their calls must be linked now or they would stay unresolved.
    resolveStoredCalls();
    throw new IndexAbortedError();
  };
  let lastYield = Date.now();
  /** Yields to the event loop when the time budget is used up, then honours an abort. */
  const breathe = async (): Promise<void> => {
    if (Date.now() - lastYield >= YIELD_INTERVAL_MS) {
      await new Promise<void>((r) => setImmediate(r));
      lastYield = Date.now();
    }
    throwIfAborted();
  };
  // Lets a pending worker-pool dispatch be abandoned as soon as the run is aborted.
  const aborted = signal
    ? new Promise<null>((resolveAborted) => {
        if (signal.aborted) resolveAborted(null);
        else signal.addEventListener('abort', () => resolveAborted(null), { once: true });
      })
    : undefined;

  throwIfAborted();
  report('scanning');

  resetOutdatedIndex(store, zvecStore);

  // Scan for files
  const files = scanProject(rootDir, config);
  filesTotal = files.length;
  report('indexing');
  await breathe();

  // Pre-initialize parser for languages we'll encounter
  const languages = new Set(files.map((f) => f.language));
  for (const lang of languages) {
    const profile = profileFor(lang);
    if (profile) await initParser(profile);
  }

  let filesIndexed = 0;
  let symbolsFound = 0;

  /**
   * True when the stored index of `file` is current: same content, and stored
   * by the tier the file belongs to now (a file changes tier when a grammar
   * for its language appears or disappears, or the language filter changes).
   */
  const isUnchanged = (file: ScannedFile, sha256: string): boolean =>
    store.getFileHash(file.filePath) === sha256
    && (store.getTextFile(file.filePath) !== undefined) === (file.tier === 'text');

  /**
   * Text tier: a file without a grammar is stored as line-range chunks. It
   * counts in the progress like a parsed file, and an abort is honoured
   * between files and between embedding batches.
   */
  const indexAsText = async (file: ScannedFile): Promise<void> => {
    try {
      const content = readFileSync(file.filePath, 'utf-8');
      const sha256 = sha256Of(content);
      if (!isUnchanged(file, sha256)) {
        // The file may have been parsed before: its symbols are gone now.
        const oldSymbols = store.getSymbolsByFile(file.filePath);
        if (oldSymbols.length > 0) {
          noteReplacedFile(callScope, store, file.filePath);
          zvecStore?.deleteByFile(file.filePath, oldSymbols.map((s) => s.id));
          store.clearSymbols(file.filePath);
          store.clearRelations(file.filePath);
        }
        await indexTextFile(store, zvecStore, { filePath: file.filePath, language: file.language, content }, {
          beforeBatch: breathe,
        });
        store.upsertFileHash(file.filePath, sha256);
        filesIndexed++;
      }
    } catch (err) {
      if (err instanceof IndexAbortedError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      log.error({ file: file.filePath, error: message }, 'Failed to index file as text');
      errors.push(`${file.filePath}: ${message}`);
    }
    filesDone++;
    report('indexing');
  };

  // Use worker pool if available and files exist
  if (pool && files.length > 0) {
    // Filter to files that actually changed
    const tasks: WorkerTask[] = [];
    /** A file needing no work (unsupported or unchanged) counts as done right away. */
    const skip = (): void => {
      filesDone++;
      report('indexing');
    };

    /** Indexed after the parsed files, so symbols become searchable first. */
    const textFiles: ScannedFile[] = [];

    for (const file of files) {
      await breathe();
      if (file.tier === 'text') {
        textFiles.push(file);
        continue;
      }
      const profile = profileFor(file.language);
      if (!profile) {
        skip();
        continue;
      }

      const content = readFileSync(file.filePath, 'utf-8');
      const sha256 = sha256Of(content);

      if (isUnchanged(file, sha256)) {
        skip();
        continue;
      }

      tasks.push({ filePath: file.filePath, language: file.language });
    }

    for (let start = 0; start < tasks.length; start += PARSE_CHUNK_SIZE) {
      throwIfAborted();
      const dispatched = pool.dispatch(tasks.slice(start, start + PARSE_CHUNK_SIZE));
      // If the run is aborted the dispatch is abandoned; a late rejection must not go unhandled.
      dispatched.catch(() => {});
      const results = (aborted ? await Promise.race([dispatched, aborted]) : await dispatched) ?? [];
      throwIfAborted();

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        await breathe();

        try {
          if (result.error) {
            errors.push(`${result.filePath}: ${result.error}`);
            continue;
          }

          // Clear old data (vectors first: their ids come from the SQLite rows)
          noteReplacedFile(callScope, store, result.filePath);
          zvecStore?.deleteByFile(result.filePath, vectorIdsOf(store, result.filePath));
          store.clearTextFile(result.filePath);
          store.clearSymbols(result.filePath);
          store.clearRelations(result.filePath);

          // Insert symbols
          for (const s of result.symbols) callScope.names.push(s.name);
          if (result.symbols.length > 0) {
            const now = Date.now();
            const rows = result.symbols.map((s) => ({
              ...s,
              updated_at: now,
            }));
            store.upsertSymbols(rows);
          }

          // Insert relations
          if (result.relations.length > 0) {
            store.upsertRelations(result.relations);
          }

          // ZVec indexing
          if (zvecStore) {
            const sourceLines = readFileSync(result.filePath, 'utf-8').split('\n');
            const chunks = chunkSymbols(result.symbols, sourceLines);
            if (chunks.length > 0) {
              const embeddings = await embedBatch(chunks.map(c => c.text));
              const searchDocs = chunks.map((c, _i) => ({
                symbolId: c.symbol.id,
                name: c.symbol.name,
                kind: c.symbol.kind,
                filePath: c.symbol.file_path,
                startLine: c.symbol.start_line,
                endLine: c.symbol.end_line,
                signature: c.symbol.signature,
                code: sourceLines.slice(c.symbol.start_line - 1, c.symbol.end_line).join('\n'),
                docComment: c.symbol.doc_comment,
                language: c.symbol.language,
              }));
              zvecStore.upsertDocs(searchDocs, embeddings);
            }
          }

          // Update hash
          store.upsertFileHash(result.filePath, result.contentHash);

          filesIndexed++;
          symbolsFound += result.symbols.length;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ file: result.filePath, error: message }, 'Failed to process file');
          errors.push(`${result.filePath}: ${message}`);
        } finally {
          filesDone++;
          report('indexing');
        }
      }
    }

    for (const file of textFiles) {
      await breathe();
      await indexAsText(file);
    }
  } else {
    // Fallback: single-threaded path (Phase 3 behavior)
    for (const file of files) {
      await breathe();
      if (file.tier === 'text') {
        await indexAsText(file);
        continue;
      }
      try {
        const profile = profileFor(file.language);
        if (!profile) continue;

        const content = readFileSync(file.filePath, 'utf-8');
        const sourceLines = content.split('\n');
        const sha256 = sha256Of(content);

        if (isUnchanged(file, sha256)) continue;

        const result = await parseFile(file.filePath, profile);

        noteReplacedFile(callScope, store, file.filePath);
        zvecStore?.deleteByFile(file.filePath, vectorIdsOf(store, file.filePath));
        store.clearTextFile(file.filePath);
        store.clearSymbols(file.filePath);

        for (const s of result.symbols) callScope.names.push(s.name);
        if (result.symbols.length > 0) {
          const now = Date.now();
          const rows = result.symbols.map((s: ExtractedSymbol) => ({
            ...s,
            updated_at: now,
          }));
          store.upsertSymbols(rows);
        }

        if (profile.relationQueries) {
          const relations = extractRelations(result.symbols, content, file.filePath, profile, result.references);
          store.clearRelations(file.filePath);
          if (relations.length > 0) {
            store.upsertRelations(relations);
          }
        }

        if (zvecStore) {
          const chunks = chunkSymbols(result.symbols, sourceLines);
          if (chunks.length > 0) {
            const embeddings = await embedBatch(chunks.map(c => c.text));
            const searchDocs = chunks.map((c, _i) => ({
              symbolId: c.symbol.id,
              name: c.symbol.name,
              kind: c.symbol.kind,
              filePath: c.symbol.file_path,
              startLine: c.symbol.start_line,
              endLine: c.symbol.end_line,
              signature: c.symbol.signature,
              code: sourceLines.slice(c.symbol.start_line - 1, c.symbol.end_line).join('\n'),
              docComment: c.symbol.doc_comment,
              language: c.symbol.language,
            }));
            zvecStore.upsertDocs(searchDocs, embeddings);
          }
        }

        store.upsertFileHash(file.filePath, sha256);

        filesIndexed++;
        symbolsFound += result.symbols.length;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ file: file.filePath, error: message }, 'Failed to index file');
        errors.push(`${file.filePath}: ${message}`);
      } finally {
        filesDone++;
        report('indexing');
      }
    }
  }

  throwIfAborted();
  report('resolving');

  resolveStoredCalls();

  const tookMs = Date.now() - startTime;
  log.info(
    { filesScanned: files.length, filesIndexed, symbolsFound, errors: errors.length, tookMs },
    'Index complete',
  );

  return {
    filesScanned: files.length,
    filesIndexed,
    symbolsFound,
    errors,
    tookMs,
  };
}
