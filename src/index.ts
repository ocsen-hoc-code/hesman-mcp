#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { loadConfig, parseCliFlagsToOverrides } from './config/loader.js';
import { SqliteStore } from './stores/sqlite.js';
import { ZVecStore } from './stores/zvec.js';
import { initEmbedding } from './stores/embedding.js';
import { indexProject, IndexAbortedError } from './indexing/index-coordinator.js';
import { indexState } from './indexing/index-state.js';
import { WorkerPool } from './indexing/worker-pool.js';
import { FileWatcher } from './indexing/file-watcher.js';
import { McpServer } from './server/mcp-server.js';
import { registerAllTools } from './server/tools/index.js';
import { LateBound } from './server/late-bound.js';
import {
  explicitProjectRoot,
  findProjectRoot,
  noProjectMessage,
  noProjectResult,
  pickProjectRoot,
} from './server/project-root.js';
import { createLogger } from './utils/logger.js';
import { MetricsCollector } from './diagnostics/metrics.js';

const log = createLogger('hesman');

/**
 * How long to wait for the client's answer to `roots/list`. Clients answer
 * from memory, so this only bounds a client that advertises roots and then
 * stays silent; tool calls wait for the answer.
 */
const ROOTS_TIMEOUT_MS = 5000;

/** Everything that belongs to the project currently being served. */
interface OpenProject {
  root: string;
  store: SqliteStore;
  zvecStore?: ZVecStore;
  metrics: MetricsCollector;
  /** Aborts the background startup (model wait, initial index). */
  abort: AbortController;
  /** Settles when the background startup has ended; never rejects. */
  startup: Promise<void>;
  watcher?: FileWatcher;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle subcommands
  if (args[0] === 'index') {
    const { runIndex } = await import('./cli/commands.js');
    await runIndex(args.slice(1));
    return;
  }

  if (args[0] === 'status') {
    const { runStatus } = await import('./cli/commands.js');
    await runStatus(args.slice(1));
    return;
  }

  if (args[0] === 'install') {
    const { runInstall } = await import('./cli/commands.js');
    await runInstall(args.slice(1));
    return;
  }

  if (args[0] === 'clean') {
    const { runClean } = await import('./cli/commands.js');
    await runClean(args.slice(1));
    return;
  }

  if (args[0] === 'diag') {
    const { runDiag } = await import('./cli/commands.js');
    await runDiag(args.slice(1));
    return;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    const { printVersion } = await import('./cli/commands.js');
    printVersion();
    return;
  }

  if (args[0] === '--help' || args[0] === '-h') {
    const { printHelp } = await import('./cli/commands.js');
    printHelp();
    return;
  }

  // ── Default: run MCP server ──
  const cliOverrides = parseCliFlagsToOverrides(args);
  const config = loadConfig(cliOverrides);
  const cwd = process.cwd();
  const semanticEnabled = config.semanticSearch.enabled;

  // The project comes from, in order: an explicit root, the client's MCP
  // roots, the working directory (see `server/project-root.ts`). Roots are
  // only known after the handshake, so without an explicit root the stores
  // open later, and the tools are registered against late-bound stand-ins.
  const explicitRoot = explicitProjectRoot(config.projectRoot, cliOverrides, process.env, cwd);

  log.info(
    { projectRoot: explicitRoot ?? '(detected after the handshake)', workers: config.workers, watchMode: config.watchMode },
    'Starting Hesman MCP server',
  );

  // Create worker pool
  const pool = new WorkerPool(config.workers);
  log.info(`Worker pool created with ${config.workers === 0 ? 'auto' : config.workers} workers`);

  const storeRef = new LateBound<SqliteStore>('The symbol index');
  const zvecRef = new LateBound<ZVecStore>('The vector index');

  const server = new McpServer('hesman', '1.0.0');
  registerAllTools(server, storeRef.ref, semanticEnabled ? zvecRef.ref : undefined, config);

  let project: OpenProject | undefined;
  /** Why the detected project could not be opened, if that is why there is none. */
  let openError: string | undefined;
  let shuttingDown = false;

  // ── Embedding model (one per process, shared by every project) ──
  let modelLoad: Promise<void> | undefined;
  let modelError: unknown;

  function loadEmbeddingModel(): Promise<void> {
    modelLoad ??= initEmbedding(config.semanticSearch.embeddingModel).then(
      () => log.info('Embedding model loaded for semantic search'),
      (err) => {
        modelError = err;
        log.warn(err, 'Failed to load embedding model — semantic search will be unavailable');
      },
    );
    return modelLoad;
  }

  // ── Background startup ──
  // The MCP handshake must never wait for the embedding model (a download on
  // the first run) or the initial index (minutes on a large repository):
  // clients give up on servers that are slow to answer `initialize`. Both run
  // in the background; tools answer from whatever is indexed so far and
  // `index_status` reports the progress kept in `indexState`.

  /** Loads the model, builds the initial index, then starts the watcher. Never rejects. */
  async function runBackgroundStartup(opened: OpenProject): Promise<void> {
    const { signal } = opened.abort;
    try {
      if (opened.zvecStore) {
        // The model must be ready before indexing: vectors are embedded per file.
        // A load cannot be cancelled; on abort stop waiting for it.
        const aborted = new Promise<void>((resolveAborted) => {
          signal.addEventListener('abort', () => resolveAborted(), { once: true });
        });
        await Promise.race([loadEmbeddingModel(), aborted]);
        if (modelError !== undefined) indexState.setModelError(modelError);
      }

      const result = await indexProject(opened.root, opened.store, config, opened.zvecStore, pool, {
        signal,
        onProgress: (progress) => indexState.update(progress),
      });
      indexState.complete();
      log.info(
        { files: result.filesIndexed, symbols: result.symbolsFound },
        'Initial indexing complete',
      );
    } catch (err) {
      if (err instanceof IndexAbortedError) {
        log.info('Initial indexing aborted');
        return;
      }
      indexState.fail(err);
      log.error(err, 'Initial indexing failed — server keeps running with an incomplete index');
    }

    // Start file watcher (if enabled) once the initial index is in place
    if (config.watchMode && !signal.aborted) {
      try {
        const startedWatcher = new FileWatcher({
          projectRoot: opened.root,
          ignore: config.ignore,
          store: opened.store,
          pool,
          zvecStore: opened.zvecStore,
        });
        opened.watcher = startedWatcher;
        await startedWatcher.start();
        log.info('File watcher started');
      } catch (err) {
        log.error(err, 'Failed to start file watcher — the index will not follow file changes');
      }
    }
  }

  // ── Project lifecycle ──

  /**
   * Opens the stores in `<root>/<dataDir>`, points the tools at them and
   * starts indexing in the background. Throws if a store cannot be opened.
   */
  function openProject(root: string, source: string): void {
    const dataDir = resolve(root, config.dataDir);
    log.info({ projectRoot: root, dataDir, source }, 'Opening project');

    const store = new SqliteStore(dataDir);
    store.open();
    let zvecStore: ZVecStore | undefined;
    if (semanticEnabled) {
      try {
        zvecStore = new ZVecStore(dataDir);
        zvecStore.open();
      } catch (err) {
        store.close();
        throw err;
      }
    }

    // Tools resolve path arguments against `config.projectRoot`.
    config.projectRoot = root;
    storeRef.bind(store);
    if (zvecStore) zvecRef.bind(zvecStore);
    openError = undefined;

    // Wire metrics collector for observability
    const metrics = new MetricsCollector(dataDir);
    server.setMetrics(metrics);
    metrics.startPeriodicFlush(60000);

    // Mark the index as in progress before any request can be answered from
    // these stores, so no client ever sees an empty index reported as complete.
    indexState.begin(zvecStore ? 'loading-model' : 'scanning');

    const opened: OpenProject = {
      root,
      store,
      zvecStore,
      metrics,
      abort: new AbortController(),
      startup: Promise.resolve(),
    };
    project = opened;
    opened.startup = runBackgroundStartup(opened);
  }

  /** Stops the initial index and the watcher. A running index stops at its next step. */
  async function haltProject(opened: OpenProject): Promise<void> {
    opened.abort.abort();
    await opened.startup;
    opened.watcher?.stop();
  }

  /** Detaches the tools from the project and closes its stores. Nothing may write to them afterwards. */
  function releaseProject(opened: OpenProject): void {
    opened.metrics.stop();
    server.setMetrics(undefined);
    if (project === opened) project = undefined;
    storeRef.unbind();
    zvecRef.unbind();
    opened.zvecStore?.close();
    opened.store.close();
  }

  // ── Project detection (no explicit root) ──
  const detectionAbort = new AbortController();

  /** The project the client or the working directory points at, or `null`. Never rejects. */
  async function detectProject(): Promise<{ root: string; source: string } | null> {
    if (server.clientSupportsRoots()) {
      try {
        const roots = await server.listRoots({ timeoutMs: ROOTS_TIMEOUT_MS, signal: detectionAbort.signal });
        const picked = pickProjectRoot(roots, homedir());
        for (const rejected of picked.rejected) {
          log.warn(rejected, 'Ignoring a root reported by the client');
        }
        if (picked.root !== null) {
          if (picked.others.length > 0) {
            log.warn(
              { indexed: picked.root, notIndexed: picked.others },
              'The client reported several roots; only the first root is indexed',
            );
          }
          return { root: picked.root, source: 'client roots' };
        }
        log.info('The client reported no usable root — trying the working directory');
      } catch (err) {
        if (detectionAbort.signal.aborted) return null;
        log.warn(err, 'The client advertises roots but roots/list failed — trying the working directory');
      }
    }

    const fromCwd = findProjectRoot(cwd, homedir());
    return fromCwd === null ? null : { root: fromCwd, source: 'working directory' };
  }

  /** Detects the project and, if it differs from the open one, switches to it. Never rejects. */
  async function applyDetectedProject(): Promise<void> {
    try {
      const detected = await detectProject();
      if (shuttingDown) return;
      if (project && detected?.root === project.root) return;

      if (project) {
        const previous = project;
        log.info({ from: previous.root, to: detected?.root ?? null }, 'The project root changed');
        await haltProject(previous);
        await pool.drain();
        if (previous.watcher) await previous.watcher.drain();
        releaseProject(previous);
        if (shuttingDown) return;
      }

      if (detected === null) {
        indexState.reset();
        log.warn(noProjectMessage(cwd));
        return;
      }
      openProject(detected.root, detected.source);
    } catch (err) {
      indexState.reset();
      openError = `The project could not be opened: ${err instanceof Error ? err.message : String(err)}`;
      log.error(err, 'Failed to open the detected project — tools will report that no project is selected');
    }
  }

  // Detections run one at a time; a burst of root changes collapses into one.
  let detectionQueue: Promise<void> = Promise.resolve();
  let detectionQueued = false;

  function scheduleDetection(): Promise<void> {
    if (!detectionQueued) {
      detectionQueued = true;
      detectionQueue = detectionQueue.then(() => {
        detectionQueued = false;
        return applyDetectedProject();
      });
    }
    return detectionQueue;
  }

  /** Resolves once it is known whether there is a project (immediately with an explicit root). */
  let markProjectDecided: () => void = () => {};
  const projectDecided = new Promise<void>((resolveDecided) => {
    markProjectDecided = resolveDecided;
  });

  // Tool calls wait for the decision (and for a root change in flight) instead
  // of failing, then either run or get the "no project" error.
  server.setToolCallGuard(async () => {
    await projectDecided;
    await detectionQueue;
    if (project) return undefined;
    return noProjectResult(cwd, openError);
  });

  // ── Graceful shutdown ──
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info(`Received ${signal}, shutting down...`);

    // 1. Stop accepting new work. A pending roots request is cancelled and a
    //    running initial index stops at its next step, so nothing writes to
    //    the stores after they close below.
    detectionAbort.abort();
    await detectionQueue;
    markProjectDecided();
    const closing = project;
    if (closing) await haltProject(closing);
    pool.pause();

    // 2. Drain in-progress work (max 5s timeout)
    const timeout = setTimeout(() => {
      log.warn('Shutdown timeout — force killing workers');
      pool.terminate(true).catch(err => log.warn(err, 'Force terminate error'));
    }, 5000);

    try {
      await pool.drain();
      if (closing?.watcher) await closing.watcher.drain();
      clearTimeout(timeout);
    } catch (err) {
      log.warn(err, 'Error draining pool during shutdown');
    }

    // 3. Flush stores in order
    await server.close();
    if (closing) releaseProject(closing);

    // 4. Terminate pool
    await pool.terminate();
    log.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // When the client dies its end of the stdio pipe closes. The SDK's
  // StdioServerTransport only fires onclose on an explicit close(), not on
  // stdin EOF, so watch stdin directly to avoid lingering as an orphan.
  process.stdin.once('end', () => shutdown('stdin closed (end)'));
  process.stdin.once('close', () => shutdown('stdin closed (close)'));

  if (explicitRoot !== null) {
    // Known up front: open it before the first request can arrive. The
    // client's roots are ignored — the user's choice wins.
    openProject(explicitRoot, 'explicit');
    markProjectDecided();
  } else {
    // Unknown until the client has said whether it has roots. Until then the
    // index counts as in progress, and tool calls wait for the decision.
    indexState.begin('resolving-root');
    server.onClientReady(() => {
      void scheduleDetection().then(markProjectDecided);
    });
    server.onRootsChanged(() => {
      log.info('The client reported a change of its roots');
      void scheduleDetection();
    });
  }

  await server.connect();
}

main().catch((err) => {
  log.error(err, 'Fatal error');
  process.exit(1);
});
