import { appendFileSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

interface RuntimeMetrics {
  ts: string;
  memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number; externalMB: number };
  performance: { cacheHits: number; cacheMisses: number; cacheHitRate: number; avgQueryMs: number; p95QueryMs: number };
  pool: { activeWorkers: number; pendingTasks: number; queueDepth: number };
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 3;

export class MetricsCollector {
  private queryTimes: number[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;
  private dataDir: string;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  recordQuery(ms: number): void {
    this.queryTimes.push(ms);
    if (this.queryTimes.length > 1000) this.queryTimes.shift();
  }

  recordCacheHit(): void { this.cacheHits++; }
  recordCacheMiss(): void { this.cacheMisses++; }

  snapshot(pool?: { activeCount: number; pendingCount: number }): RuntimeMetrics {
    const total = this.cacheHits + this.cacheMisses;
    const sorted = [...this.queryTimes].sort((a, b) => a - b);
    const p95Index = Math.ceil(sorted.length * 0.95);

    return {
      ts: new Date().toISOString(),
      memory: {
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        externalMB: Math.round(process.memoryUsage().external / 1024 / 1024),
      },
      performance: {
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
        cacheHitRate: total > 0 ? Math.round((this.cacheHits / total) * 1000) / 1000 : 0,
        avgQueryMs: this.queryTimes.length > 0
          ? Math.round(this.queryTimes.reduce((a, b) => a + b, 0) / this.queryTimes.length * 100) / 100
          : 0,
        p95QueryMs: sorted.length > 0 ? sorted[p95Index] || sorted[sorted.length - 1] : 0,
      },
      pool: {
        activeWorkers: pool?.activeCount ?? 0,
        pendingTasks: pool?.pendingCount ?? 0,
        queueDepth: pool?.pendingCount ?? 0,
      },
    };
  }

  startPeriodicFlush(intervalMs = 60000): void {
    this.intervalId = setInterval(() => this.flush(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private flush(): void {
    const metricsPath = join(this.dataDir, 'metrics.jsonl');
    const snapshot = this.snapshot();
    appendFileSync(metricsPath, JSON.stringify(snapshot) + '\n');

    // Rotate if too large
    if (existsSync(metricsPath) && statSync(metricsPath).size > MAX_FILE_SIZE) {
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const oldPath = join(this.dataDir, `metrics.${i - 1}.jsonl`);
        const newPath = join(this.dataDir, `metrics.${i}.jsonl`);
        if (existsSync(oldPath)) {
          if (existsSync(newPath)) unlinkSync(newPath);
          renameSync(oldPath, newPath);
        }
      }
    }
  }
}
