import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const log = createLogger('worker-pool');

export interface WorkerTask {
  filePath: string;
  language: string;
}

export interface WorkerResult {
  filePath: string;
  symbols: Array<{
    id: string;
    name: string;
    kind: string;
    file_path: string;
    start_line: number;
    end_line: number;
    start_col: number;
    end_col: number;
    signature: string | null;
    doc_comment: string | null;
    parent_id: string | null;
    language: string;
    is_exported: number;
  }>;
  relations: Array<{
    from_id: string;
    to_id: string;
    kind: string;
    file_path: string;
    line: number;
    col: number;
    /** Callee name of a `calls` relation (see `resolveCallRelations`). */
    to_name?: string | null;
receiver?: string | null;
receiverType?: string | null;
names?: string | null;
  }>;
  contentHash: string;
  error?: string;
}

interface PendingTask {
  task: WorkerTask;
  resolve: (result: WorkerResult) => void;
  reject: (err: Error) => void;
}

/** Above this, more parser threads no longer shorten an index run but each costs memory. */
export const MAX_AUTO_WORKERS = 4;

/** An idle worker is stopped after this long, so its parsers do not stay in memory between runs. */
export const IDLE_RELEASE_MS = 30_000;

export interface WorkerPoolOptions {
  /** Idle time before a worker is stopped; defaults to `IDLE_RELEASE_MS`. */
  idleReleaseMs?: number;
}

/**
 * Parser threads, started on demand and stopped again when idle.
 *
 * A worker holds its own V8 isolate and its own Tree-sitter grammars, tens of
 * megabytes each, and the server needs them only while it indexes. So no
 * worker exists until a task arrives, at most `maxWorkers` run at once, and a
 * worker that has had nothing to do for `idleReleaseMs` is terminated; the
 * next task starts a new one.
 */
export class WorkerPool {
  /** One slot per possible worker; `null` while that worker is not running. */
  private workers: Array<Worker | null>;
  private taskQueue: PendingTask[] = [];
  private busyWorkers: Set<number> = new Set();
  private workerTasks: Map<number, PendingTask> = new Map();
  private idleTimers: Map<number, NodeJS.Timeout> = new Map();
  /** Workers this pool stopped on purpose: their exit is not a crash. */
  private retired: WeakSet<Worker> = new WeakSet();
  private paused = false;
  private shuttingDown = false;
  private workerPath: string;
  private idleReleaseMs: number;

  readonly maxWorkers: number;

  constructor(size: number, options: WorkerPoolOptions = {}) {
    this.maxWorkers = size === 0 ? Math.min(MAX_AUTO_WORKERS, Math.max(1, cpus().length - 1)) : Math.max(1, size);
    this.workers = new Array<Worker | null>(this.maxWorkers).fill(null);
    this.idleReleaseMs = options.idleReleaseMs ?? IDLE_RELEASE_MS;

    // Primary: compiled worker next to this file (production, dist/)
    const primaryPath = resolve(__dirname, 'worker.js');
    // Fallback: source-relative dist path (dev/test via vitest/tsx)
    const fallbackPath = resolve(__dirname, '..', '..', 'dist', 'indexing', 'worker.js');

    const workerPath = existsSync(primaryPath) ? primaryPath : fallbackPath;
    if (!existsSync(workerPath)) {
      throw new Error(
        `worker.js not found at ${primaryPath} or ${fallbackPath}. Ensure the project is built (npx tsc).`,
      );
    }
    this.workerPath = workerPath;
  }

  /** Worker threads running right now. */
  get workerCount(): number {
    return this.workers.filter((worker) => worker !== null).length;
  }

  private startWorker(index: number): Worker {
    const worker = new Worker(this.workerPath);
    this.setupWorker(worker, index);
    this.workers[index] = worker;
    return worker;
  }

  private setupWorker(worker: Worker, index: number): void {
    worker.on('message', (result: WorkerResult) => {
      // Resolve the pending task for this worker
      const pending = this.workerTasks.get(index);
      if (pending) {
        pending.resolve(result);
        this.workerTasks.delete(index);
      }
      this.busyWorkers.delete(index);
      // Process next task from queue
      this.flushQueue();
      if (!this.busyWorkers.has(index)) this.scheduleRelease(index);
    });

    worker.on('error', (err) => {
      const pending = this.workerTasks.get(index);
      if (pending) {
        pending.reject(err);
        this.workerTasks.delete(index);
      }
      this.busyWorkers.delete(index);
      this.flushQueue();
    });

    worker.on('exit', (code) => {
      if (this.retired.has(worker)) return;
      if (this.workers[index] === worker) this.workers[index] = null;
      if (code !== 0 && !this.shuttingDown) {
        log.warn({ index, code }, 'Worker exited unexpectedly, restarting...');
        this.busyWorkers.delete(index);
        this.startWorker(index);
        this.flushQueue();
      }
    });
  }

  /** Stop the worker in this slot once it has been idle for `idleReleaseMs`. */
  private scheduleRelease(index: number): void {
    this.cancelRelease(index);
    const timer = setTimeout(() => {
      this.idleTimers.delete(index);
      const worker = this.workers[index];
      if (!worker || this.busyWorkers.has(index) || this.shuttingDown) return;
      this.retired.add(worker);
      this.workers[index] = null;
      void worker.terminate();
      log.debug({ index }, 'Idle worker released');
    }, this.idleReleaseMs);
    // A pending release must not keep the process alive.
    timer.unref();
    this.idleTimers.set(index, timer);
  }

  private cancelRelease(index: number): void {
    const timer = this.idleTimers.get(index);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(index);
    }
  }

  /** A slot that can take a task: a running idle worker first, else an empty slot. */
  private freeSlot(): number {
    const idle = this.workers.findIndex((worker, i) => worker !== null && !this.busyWorkers.has(i));
    if (idle !== -1) return idle;
    return this.workers.findIndex((worker) => worker === null);
  }

  private flushQueue(): void {
    if (this.taskQueue.length === 0) return;
    if (this.paused || this.shuttingDown) return;

    const index = this.freeSlot();
    if (index === -1) return;

    const pending = this.taskQueue.shift()!;
    const worker = this.workers[index] ?? this.startWorker(index);
    this.cancelRelease(index);
    this.busyWorkers.add(index);
    this.workerTasks.set(index, pending);
    worker.postMessage(pending.task);
  }

  dispatch(tasks: WorkerTask[]): Promise<WorkerResult[]> {
    if (this.paused) {
      return Promise.reject(new Error('WorkerPool is paused — not accepting new tasks'));
    }

    const results: WorkerResult[] = [];
    const promises: Promise<void>[] = [];

    for (const task of tasks) {
      promises.push(new Promise<void>((resolve, reject) => {
        this.taskQueue.push({
          task,
          resolve: (result: WorkerResult) => {
            results.push(result);
            resolve();
          },
          reject,
        });
      }));
    }

    // Trigger processing — multiple calls to flushQueue will use multiple idle workers
    const freeCount = this.maxWorkers - this.busyWorkers.size;
    for (let i = 0; i < Math.min(freeCount, this.taskQueue.length); i++) {
      this.flushQueue();
    }

    return Promise.all(promises).then(() => results);
  }

  pause(): void {
    this.paused = true;
  }

  async drain(): Promise<void> {
    while (this.busyWorkers.size > 0) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.taskQueue.length = 0;
  }

  async terminate(force: boolean = false): Promise<void> {
    this.shuttingDown = true;
    if (!force) {
      await this.drain();
    } else {
      // Clear busy set so drain() doesn't deadlock after force kill
      this.busyWorkers.clear();
      this.taskQueue.length = 0;
    }
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    for (const worker of this.workers) {
      if (worker) await worker.terminate();
    }
    this.workers.fill(null);
    this.workerTasks.clear();
  }

  get activeCount(): number {
    return this.busyWorkers.size;
  }

  get pendingCount(): number {
    return this.taskQueue.length;
  }
}
