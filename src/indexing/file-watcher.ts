import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { WorkerPool } from './worker-pool.js';
import type { SqliteStore } from '../stores/sqlite.js';
import type { ZVecStore } from '../stores/zvec.js';
import { chunkSymbols } from '../parsers/chunker.js';
import { embedBatch } from '../stores/embedding.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('file-watcher');

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
};

export interface FileWatcherConfig {
  projectRoot: string;
  ignore: string[];
  store: SqliteStore;
  pool: WorkerPool;
  zvecStore?: ZVecStore;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private config: FileWatcherConfig;
  private pending: Set<string> = new Set();
  private changeTimestamps = new Map<string, number>();

  constructor(config: FileWatcherConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const ignored = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/.hesman/**',
      ...this.config.ignore,
    ];

    this.watcher = watch(this.config.projectRoot, {
      ignored,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 20,
      },
    });

    this.watcher.on('change', (filePath: string) => this.handleChange(filePath));
    this.watcher.on('add', (filePath: string) => this.handleChange(filePath));
    this.watcher.on('unlink', (filePath: string) => this.handleDelete(filePath));

    log.info({ projectRoot: this.config.projectRoot }, 'File watcher started');
  }

  private async handleChange(filePath: string): Promise<void> {
    const lang = EXT_TO_LANG[extname(filePath)];
    if (!lang) return;

    const now = Date.now();
    const lastChange = this.changeTimestamps.get(filePath) || 0;
    if (now - lastChange < 2000) return; // rate limit: 2s per file
    this.changeTimestamps.set(filePath, now);

    if (this.pending.has(filePath)) return;
    this.pending.add(filePath);

    try {
      const content = readFileSync(filePath, 'utf-8');
      const sha256 = createHash('sha256').update(content).digest('hex');
      const previousHash = this.config.store.getFileHash(filePath);

      if (previousHash === sha256) {
        this.pending.delete(filePath);
        return;
      }

      const results = await this.config.pool.dispatch([{ filePath, language: lang }]);
      const result = results[0];

      if (result.error) {
        log.warn({ file: filePath, error: result.error }, 'Failed to re-index file');
        this.pending.delete(filePath);
        return;
      }

      // Update stores
      this.config.store.clearSymbols(filePath);
      this.config.store.clearRelations(filePath);

      if (result.symbols.length > 0) {
        const now = Date.now();
        const rows = result.symbols.map((s) => ({ ...s, updated_at: now }));
        this.config.store.upsertSymbols(rows);
      }

      if (result.relations.length > 0) {
        this.config.store.upsertRelations(result.relations);
      }

      if (this.config.zvecStore) {
        const sourceLines = content.split('\n');
        const chunks = chunkSymbols(result.symbols, sourceLines);
        if (chunks.length > 0) {
          try {
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
            this.config.zvecStore.upsertDocs(searchDocs, embeddings);
          } catch {
            log.warn({ file: filePath }, 'Failed to update vector index');
          }
        }
      }

      this.config.store.upsertFileHash(filePath, sha256);
      log.debug({ file: filePath }, 'File re-indexed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ file: filePath, error: message }, 'Error handling file change');
    } finally {
      this.pending.delete(filePath);
    }
  }

  private handleDelete(filePath: string): void {
    this.config.store.clearSymbols(filePath);
    this.config.store.clearRelations(filePath);
    log.debug({ file: filePath }, 'File removed from index');
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    log.info('File watcher stopped');
  }

  async drain(): Promise<void> {
    // Wait for pending file events to be processed
    while (this.pending.size > 0) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
