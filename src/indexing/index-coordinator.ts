import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chunkSymbols } from '../parsers/chunker.js';
import { embedBatch } from '../stores/embedding.js';
import type { ZVecStore } from '../stores/zvec.js';
import { createLogger } from '../utils/logger.js';
import type { HesmanConfig } from '../config/schema.js';
import type { SqliteStore } from '../stores/sqlite.js';
import { scanProject } from './project-scanner.js';
import { parseFile, initParser, type ExtractedSymbol } from '../parsers/core.js';
import { extractRelations } from '../parsers/relation-extractor.js';
import { profileFor } from '../parsers/languages.js';
import { WorkerPool, WorkerTask } from './worker-pool.js';

const log = createLogger('index-coordinator');

export interface IndexResult {
  filesScanned: number;
  filesIndexed: number;
  symbolsFound: number;
  errors: string[];
  tookMs: number;
}

export async function indexProject(
  rootDir: string,
  store: SqliteStore,
  config: HesmanConfig,
  zvecStore?: ZVecStore,
  pool?: WorkerPool,
): Promise<IndexResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  // Scan for files
  const files = scanProject(rootDir, config);

  // Pre-initialize parser for languages we'll encounter
  const languages = new Set(files.map((f) => f.language));
  for (const lang of languages) {
    const profile = profileFor(lang);
    if (profile) await initParser(profile);
  }

  let filesIndexed = 0;
  let symbolsFound = 0;

  // Use worker pool if available and files exist
  if (pool && files.length > 0) {
    // Filter to files that actually changed
    const tasks: WorkerTask[] = [];
    const validFiles: typeof files = [];

    for (const file of files) {
      const profile = profileFor(file.language);
      if (!profile) continue;

      const content = readFileSync(file.filePath, 'utf-8');
      const sha256 = createHash('sha256').update(content).digest('hex');
      const previousHash = store.getFileHash(file.filePath);

      if (previousHash === sha256) continue;

      tasks.push({ filePath: file.filePath, language: file.language });
      validFiles.push(file);
    }

    if (tasks.length > 0) {
      const results = await pool.dispatch(tasks);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];

        try {
          if (result.error) {
            errors.push(`${result.filePath}: ${result.error}`);
            continue;
          }

          // Clear old data
          store.clearSymbols(result.filePath);
          store.clearRelations(result.filePath);

          // Insert symbols
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
                code: sourceLines.slice(c.symbol.start_line, c.symbol.end_line + 1).join('\n'),
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
        }
      }
    }
  } else {
    // Fallback: single-threaded path (Phase 3 behavior)
    for (const file of files) {
      try {
        const profile = profileFor(file.language);
        if (!profile) continue;

        const content = readFileSync(file.filePath, 'utf-8');
        const sourceLines = content.split('\n');
        const sha256 = createHash('sha256').update(content).digest('hex');
        const previousHash = store.getFileHash(file.filePath);

        if (previousHash === sha256) continue;

        const result = await parseFile(file.filePath, profile);

        store.clearSymbols(file.filePath);

        if (result.symbols.length > 0) {
          const now = Date.now();
          const rows = result.symbols.map((s: ExtractedSymbol) => ({
            ...s,
            updated_at: now,
          }));
          store.upsertSymbols(rows);
        }

        if (profile.relationQueries) {
          const relations = extractRelations(result.symbols, content, file.filePath, profile);
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
              code: sourceLines.slice(c.symbol.start_line, c.symbol.end_line + 1).join('\n'),
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
      }
    }
  }

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
