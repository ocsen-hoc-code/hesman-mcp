import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  }>;
  contentHash: string;
  error?: string;
}

interface PendingTask {
  task: WorkerTask;
  resolve: (result: WorkerResult) => void;
  reject: (err: Error) => void;
}

export class WorkerPool {
  private workers: Worker[];
  private taskQueue: PendingTask[] = [];
  private busyWorkers: Set<number> = new Set();
  private workerTasks: Map<number, PendingTask> = new Map();
  private paused = false;

  constructor(size: number) {
    const workerCount = size === 0 ? Math.max(1, cpus().length - 1) : Math.max(1, size);
    this.workers = [];

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

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerPath);
      this.setupWorker(worker, i);
      this.workers.push(worker);
    }
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
  }

  private flushQueue(): void {
    if (this.taskQueue.length === 0) return;
    if (this.paused) return;

    const idleIndex = this.workers.findIndex((_, i) => !this.busyWorkers.has(i));
    if (idleIndex === -1) return;

    const pending = this.taskQueue.shift()!;
    this.busyWorkers.add(idleIndex);
    this.workerTasks.set(idleIndex, pending);
    this.workers[idleIndex].postMessage(pending.task);
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
    const idleCount = this.workers.filter((_, i) => !this.busyWorkers.has(i)).length;
    for (let i = 0; i < Math.min(idleCount, this.taskQueue.length); i++) {
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
    if (!force) {
      await this.drain();
    } else {
      // Clear busy set so drain() doesn't deadlock after force kill
      this.busyWorkers.clear();
      this.taskQueue.length = 0;
    }
    for (const worker of this.workers) {
      await worker.terminate();
    }
    this.workers.length = 0;
    this.workerTasks.clear();
  }

  get activeCount(): number {
    return this.busyWorkers.size;
  }

  get pendingCount(): number {
    return this.taskQueue.length;
  }
}
