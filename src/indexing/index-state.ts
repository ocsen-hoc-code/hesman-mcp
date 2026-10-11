/**
 * Shared state of the initial (background) index run.
 *
 * The MCP server answers the handshake before the index exists, so tools need
 * a cheap way to tell an agent that results may still be incomplete. The index
 * coordinator reports progress through a callback, the server entry point
 * feeds it into this object, and tools only ever read it.
 */

/** Phases reported by `indexProject` through its progress callback. */
export type IndexRunPhase = 'scanning' | 'indexing' | 'resolving';

/**
 * - `idle`          — no run started (CLI commands, unit tests).
 * - `loading-model` — waiting for the embedding model before indexing.
 * - `scanning`      — listing project files.
 * - `indexing`      — hashing, parsing and storing files.
 * - `resolving`     — linking call relations after every file is stored.
 * - `ready`         — the run finished.
 * - `failed`        — the run threw; `error` holds the message.
 */
export type IndexPhase = 'idle' | 'loading-model' | IndexRunPhase | 'ready' | 'failed';

export interface IndexProgress {
  phase: IndexRunPhase;
  /** Files handled so far: skipped as unchanged, stored, or failed. */
  filesDone: number;
  /** Files found by the scan (0 while scanning). */
  filesTotal: number;
}

export interface IndexStateSnapshot {
  inProgress: boolean;
  phase: IndexPhase;
  filesDone: number;
  filesTotal: number;
  /** Epoch ms when the run began, `null` before the first run. */
  startedAt: number | null;
  /** Epoch ms when the run completed or failed, `null` while running. */
  finishedAt: number | null;
  /** Message of the error that ended the run, if any. */
  error: string | null;
  /** Message of the embedding model load failure, if any. */
  modelError: string | null;
}

/** Added to `_meta` of tool responses while a run is in progress. */
export interface IndexingMarker {
  inProgress: true;
  filesDone: number;
  filesTotal: number;
}

const ACTIVE_PHASES: ReadonlySet<IndexPhase> = new Set(['loading-model', 'scanning', 'indexing', 'resolving']);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class IndexState {
  private phase: IndexPhase = 'idle';
  private filesDone = 0;
  private filesTotal = 0;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private error: string | null = null;
  private modelError: string | null = null;

  get inProgress(): boolean {
    return ACTIVE_PHASES.has(this.phase);
  }

  /** Starts a run, clearing the outcome of the previous one. */
  begin(phase: 'loading-model' | 'scanning' = 'scanning', now: number = Date.now()): void {
    this.phase = phase;
    this.filesDone = 0;
    this.filesTotal = 0;
    this.startedAt = now;
    this.finishedAt = null;
    this.error = null;
    this.modelError = null;
  }

  /** Records progress of the running index. Ignored once the run has ended. */
  update(progress: IndexProgress): void {
    if (!this.inProgress) return;
    this.phase = progress.phase;
    this.filesDone = progress.filesDone;
    this.filesTotal = progress.filesTotal;
  }

  complete(now: number = Date.now()): void {
    this.phase = 'ready';
    this.finishedAt = now;
  }

  fail(error: unknown, now: number = Date.now()): void {
    this.phase = 'failed';
    this.error = messageOf(error);
    this.finishedAt = now;
  }

  /** The embedding model failed to load; indexing itself may still succeed. */
  setModelError(error: unknown): void {
    this.modelError = messageOf(error);
  }

  snapshot(): IndexStateSnapshot {
    return {
      inProgress: this.inProgress,
      phase: this.phase,
      filesDone: this.filesDone,
      filesTotal: this.filesTotal,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      modelError: this.modelError,
    };
  }

  /** Marker for `_meta`, or `undefined` when idle so normal responses do not grow. */
  marker(): IndexingMarker | undefined {
    if (!this.inProgress) return undefined;
    return { inProgress: true, filesDone: this.filesDone, filesTotal: this.filesTotal };
  }

  /** Back to `idle` (tests). */
  reset(): void {
    this.begin();
    this.phase = 'idle';
    this.startedAt = null;
  }
}

/**
 * State of this process' index run. One server process indexes one project,
 * so a module-level instance (like the embedding pipeline in
 * `stores/embedding.ts`) avoids threading the object through every tool.
 */
export const indexState = new IndexState();
