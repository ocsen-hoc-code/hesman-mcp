import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer, toolText, type HesmanTestServer } from './helpers/server.js';

/**
 * M2-01: the MCP handshake must not wait for the index. The fixture is
 * generated (never committed) and sized so that indexing with one worker takes
 * well over 5 s, far longer than any client's patience for `initialize`.
 */
const DIR_COUNT = 60;
const FILES_PER_DIR = 100;
const FILE_COUNT = DIR_COUNT * FILES_PER_DIR;
/** Files the index run handles: the modules plus `package.json`, which the text tier indexes. */
const SCANNED_FILE_COUNT = FILE_COUNT + 1;
const FUNCTIONS_PER_FILE = 6;

interface IndexingBlock {
  inProgress: boolean;
  phase: string;
  filesDone: number;
  filesTotal: number;
  startedAt: string | null;
  error: string | null;
}

interface Status {
  totalFiles: number;
  totalSymbols: number;
  pendingFiles: number;
  indexing: IndexingBlock;
}

interface FindSymbolBody {
  symbols: Array<{ name: string }>;
  _meta: { indexing?: { inProgress: boolean; filesDone: number; filesTotal: number } };
}

function moduleSource(index: number): string {
  const parts: string[] = [];
  for (let f = 0; f < FUNCTIONS_PER_FILE; f++) {
    const callee = f === 0 ? `${index}` : `gen${index}_${f - 1}(value)`;
    parts.push(
      `/** Generated function ${f} of module ${index}. */\n` +
        `export function gen${index}_${f}(value: number): number {\n  return ${callee} + ${f};\n}\n`,
    );
  }
  return parts.join('\n');
}

function generateProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'hesman-e2e-large-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'hesman-large-fixture', private: true }));
  for (let d = 0; d < DIR_COUNT; d++) {
    const dir = join(root, 'src', `pkg${d}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < FILES_PER_DIR; f++) {
      const index = d * FILES_PER_DIR + f;
      writeFileSync(join(dir, `mod${index}.ts`), moduleSource(index));
    }
  }
  return root;
}

function childOf(server: HesmanTestServer): ChildProcess {
  // The harness keeps the child private; tests reach it to signal the process
  // or close its stdin the way a real client would.
  return (server.transport as unknown as { child: ChildProcess }).child;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null | 'timeout'> {
  const exited = new Promise<number | null>((resolveExit) => {
    child.once('exit', (code) => resolveExit(code));
  });
  const timeout = new Promise<'timeout'>((resolveTimeout) => {
    setTimeout(() => resolveTimeout('timeout'), timeoutMs).unref();
  });
  return Promise.race([exited, timeout]);
}

/** Polls `index_status` until the background index has stored some files but is still running. */
async function waitUntilMidIndex(server: HesmanTestServer): Promise<Status> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const status = await server.callToolJson<Status>('index_status');
    if (!status.indexing.inProgress) throw new Error(`Indexing finished too early: ${JSON.stringify(status.indexing)}`);
    if (status.indexing.filesDone > 0) return status;
    if (Date.now() > deadline) throw new Error(`No indexing progress: ${JSON.stringify(status.indexing)}`);
    await delay(25);
  }
}

describe('E2E — non-blocking startup on a large project', () => {
  let projectRoot: string;
  let server: HesmanTestServer | undefined;

  beforeAll(() => {
    projectRoot = generateProject();
  }, 60_000);

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const start = (): Promise<HesmanTestServer> =>
    startServer({ fixture: projectRoot, waitForIndex: false, extraArgs: ['--workers', '1'] });

  it('answers initialize and tools/list within 1 s, then indexes in the background', async () => {
    // The clock covers process boot, which competes for CPU with the servers of
    // the other e2e files started at the same moment (measured: 0.2 s alone,
    // up to 1.1 s with 13 servers booting together). Boot noise is not what
    // this test is about, so take the best of a few attempts; a startup that
    // waits for the index needs ~10 s here on every attempt.
    let spawnedAt = 0;
    let initializeMs = 0;
    let handshakeMs = Infinity;
    for (let attempt = 1; attempt <= 3 && handshakeMs >= 1000; attempt++) {
      await server?.stop();
      spawnedAt = performance.now();
      server = await start(); // resolves once `initialize` has completed
      initializeMs = performance.now() - spawnedAt;
      const { tools } = await server.client.listTools();
      handshakeMs = performance.now() - spawnedAt;
      expect(tools.map((t) => t.name)).toContain('index_status');
    }
    expect(handshakeMs).toBeLessThan(1000);
    if (!server) throw new Error('unreachable: server was started above');

    // The index is still being built, and says so.
    const first = await server.callToolJson<Status>('index_status');
    expect(first.indexing.inProgress).toBe(true);
    expect(first.indexing.startedAt).not.toBeNull();

    const samples: IndexingBlock[] = [first.indexing];
    let duringIndexing: FindSymbolBody | undefined;
    // Latency of requests answered while files were being hashed, parsed and stored.
    let slowestWhileIndexingMs = 0;
    // Latency of any request, including one that waited for the final call-linking step.
    let slowestCallMs = 0;
    let last = first;
    const deadline = Date.now() + 90_000;

    const distinctSteps = (): number => new Set(samples.map((s) => s.filesDone)).size;

    // Sample progress by hand for a while...
    while (last.indexing.inProgress && !(duringIndexing && distinctSteps() > 8)) {
      expect(Date.now()).toBeLessThan(deadline);
      await delay(100);

      if (!duringIndexing && last.totalSymbols > 0) {
        const result = await server.callTool('find_symbol', { name: 'gen', matchMode: 'prefix', topK: 5 });
        expect(result.isError).toBeFalsy();
        const body = JSON.parse(toolText(result)) as FindSymbolBody;
        // Only keep it if the run was still in flight when the tool answered.
        if (body._meta.indexing) duringIndexing = body;
      }

      const callStart = performance.now();
      last = await server.callToolJson<Status>('index_status');
      const callMs = performance.now() - callStart;
      slowestCallMs = Math.max(slowestCallMs, callMs);
      if (last.indexing.phase === 'indexing') slowestWhileIndexingMs = Math.max(slowestWhileIndexingMs, callMs);
      samples.push(last.indexing);
    }
    // ...then let the harness wait: it must hold on until the whole index is
    // built, not return as soon as the first files are stored.
    expect(last.indexing.inProgress).toBe(true);
    last = (await server.waitForIndex(90_000)) as unknown as Status;
    samples.push(last.indexing);
    const indexingMs = performance.now() - spawnedAt;

    // Progress only ever grows, in many steps, up to the full project.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].filesDone).toBeGreaterThanOrEqual(samples[i - 1].filesDone);
    }
    expect(distinctSteps()).toBeGreaterThan(5);
    expect(samples.some((s) => s.inProgress && s.filesTotal === SCANNED_FILE_COUNT && s.filesDone < FILE_COUNT)).toBe(true);

    // A tool call during indexing returns results from the partial index, marked as such.
    expect(duringIndexing).toBeDefined();
    expect(duringIndexing!.symbols.length).toBeGreaterThan(0);
    expect(duringIndexing!._meta.indexing).toMatchObject({ inProgress: true, filesTotal: SCANNED_FILE_COUNT });
    expect(duringIndexing!._meta.indexing!.filesDone).toBeLessThan(FILE_COUNT);

    // Requests do not queue behind the indexer while it works through the files.
    expect(slowestWhileIndexingMs).toBeLessThan(1000);

    // Afterwards: complete, no error, and the marker is gone.
    expect(last.indexing).toMatchObject({
      inProgress: false,
      phase: 'ready',
      filesDone: SCANNED_FILE_COUNT,
      filesTotal: SCANNED_FILE_COUNT,
      error: null,
    });
    expect(last.pendingFiles).toBe(0);
    expect(last.totalFiles).toBe(FILE_COUNT);
    expect(last.totalSymbols).toBe(FILE_COUNT * FUNCTIONS_PER_FILE);
    const after = await server.callToolJson<FindSymbolBody>('find_symbol', { name: 'gen0_0', matchMode: 'exact' });
    expect(after.symbols.map((s) => s.name)).toEqual(['gen0_0']);
    expect(after._meta.indexing).toBeUndefined();

    // The fixture really is one that a blocking startup could not have served in time.
    expect(indexingMs).toBeGreaterThan(5000);
    expect(server.nonProtocolStdoutLines).toEqual([]);

    console.log(
      `[M2-01] ${FILE_COUNT} files: initialize ${initializeMs.toFixed(0)} ms, ` +
        `initialize + tools/list ${handshakeMs.toFixed(0)} ms, index ${indexingMs.toFixed(0)} ms, ` +
        `slowest index_status while indexing ${slowestWhileIndexingMs.toFixed(0)} ms, ` +
        `slowest overall ${slowestCallMs.toFixed(0)} ms`,
    );
  }, 120_000);

  it.each([
    ['SIGTERM', (child: ChildProcess) => void child.kill('SIGTERM')],
    ['stdin close', (child: ChildProcess) => void child.stdin?.end()],
  ] as const)('shuts down cleanly on %s while the index is still running', async (_name, trigger) => {
    server = await start();
    const status = await waitUntilMidIndex(server);
    expect(status.indexing.filesDone).toBeLessThan(FILE_COUNT);

    const child = childOf(server);
    const exited = waitForExit(child, 10_000);
    trigger(child);

    expect(await exited).toBe(0);
    const stderr = server.stderrLines.join('\n');
    expect(stderr).toMatch(/Shutdown complete/);
    expect(stderr).not.toMatch(/unhandled|uncaught|Fatal error|Failed to process file/i);
    expect(server.nonProtocolStdoutLines).toEqual([]);
  }, 60_000);
});
