#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadConfig, parseCliFlagsToOverrides } from './config/loader.js';
import { SqliteStore } from './stores/sqlite.js';
import { ZVecStore } from './stores/zvec.js';
import { initEmbedding } from './stores/embedding.js';
import { indexProject } from './indexing/index-coordinator.js';
import { WorkerPool } from './indexing/worker-pool.js';
import { FileWatcher } from './indexing/file-watcher.js';
import { McpServer } from './server/mcp-server.js';
import { registerAllTools } from './server/tools/index.js';
import { createLogger } from './utils/logger.js';
import { MetricsCollector } from './diagnostics/metrics.js';

const log = createLogger('hesman');

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

  // Auto-detect project root if not explicitly set
  if (config.projectRoot === '.') {
    const { detectProjectRoot } = await import('./config/loader.js');
    config.projectRoot = detectProjectRoot(process.cwd());
  }

  const projectRoot = resolve(config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);

  log.info({ projectRoot, dataDir, workers: config.workers, watchMode: config.watchMode }, 'Starting Hesman MCP server');

  // Open stores
  const store = new SqliteStore(dataDir);
  store.open();

  let zvecStore: ZVecStore | undefined;
  if (config.semanticSearch.enabled) {
    zvecStore = new ZVecStore(dataDir);
    zvecStore.open();
    try {
      await initEmbedding(config.semanticSearch.embeddingModel);
      log.info('Embedding model loaded for semantic search');
    } catch (err) {
      log.warn(err, 'Failed to load embedding model — semantic search will be unavailable');
    }
  }

  // Create worker pool
  const pool = new WorkerPool(config.workers);
  log.info(`Worker pool created with ${config.workers === 0 ? 'auto' : config.workers} workers`);

  // File watcher
  let watcher: FileWatcher | undefined;

  // Initial index
  try {
    const result = await indexProject(projectRoot, store, config, zvecStore, pool);
    log.info(
      { files: result.filesIndexed, symbols: result.symbolsFound },
      'Initial indexing complete',
    );
  } catch (err) {
    log.error(err, 'Initial indexing failed — server starting with incomplete index');
  }

  // Start file watcher (if enabled)
  if (config.watchMode) {
    watcher = new FileWatcher({
      projectRoot,
      ignore: config.ignore,
      store,
      pool,
      zvecStore,
    });
    await watcher.start();
    log.info('File watcher started');
  }

  // Start MCP server
  const server = new McpServer('hesman', '1.0.0');
  registerAllTools(server, store, zvecStore, config);

  // Wire metrics collector for observability
  const metrics = new MetricsCollector(dataDir);
  server.setMetrics(metrics);
  metrics.startPeriodicFlush(60000);

  // ── Graceful shutdown ──
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info(`Received ${signal}, shutting down...`);

    // 1. Stop accepting new work
    watcher?.stop();
    pool.pause();

    // 2. Drain in-progress work (max 5s timeout)
    const timeout = setTimeout(() => {
      log.warn('Shutdown timeout — force killing workers');
      pool.terminate(true).catch(err => log.warn(err, 'Force terminate error'));
    }, 5000);

    try {
      await pool.drain();
      if (watcher) await watcher.drain();
      clearTimeout(timeout);
    } catch (err) {
      log.warn(err, 'Error draining pool during shutdown');
    }

    // 3. Flush stores in order
    await server.close();
    zvecStore?.close();
    store.close();

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

  await server.connect();
}

main().catch((err) => {
  log.error(err, 'Fatal error');
  process.exit(1);
});
