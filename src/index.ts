#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadConfig } from './config/loader';
import { SqliteStore } from './stores/sqlite';
import { indexProject } from './indexing/index-coordinator';
import { McpServer } from './server/mcp-server';
import { registerAllTools } from './server/tools/index';
import { createLogger } from './utils/logger';

const log = createLogger('hesman');

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle subcommands
  if (args[0] === 'index') {
    const { runIndex } = await import('./cli/commands');
    await runIndex(args.slice(1));
    return;
  }

  if (args[0] === 'status') {
    const { runStatus } = await import('./cli/commands');
    await runStatus(args.slice(1));
    return;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    const { printVersion } = await import('./cli/commands');
    printVersion();
    return;
  }

  if (args[0] === '--help' || args[0] === '-h') {
    const { printHelp } = await import('./cli/commands');
    printHelp();
    return;
  }

  // Default: run MCP server
  const config = loadConfig();
  const projectRoot = resolve(config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);
  const store = new SqliteStore(dataDir);

  log.info({ projectRoot, dataDir }, 'Starting Hesman MCP server');

  // Open store
  store.open();

  // Run initial index (single-threaded, synchronous for Phase 1)
  try {
    const result = await indexProject(projectRoot, store, config);
    log.info(
      { files: result.filesIndexed, symbols: result.symbolsFound },
      'Initial indexing complete',
    );
  } catch (err) {
    log.error(err, 'Initial indexing failed — server starting with incomplete index');
  }

  // Start MCP server
  const server = new McpServer('hesman', '0.1.0');
  registerAllTools(server, store);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    log.info('Received SIGINT, shutting down...');
    await server.close();
    store.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log.info('Received SIGTERM, shutting down...');
    await server.close();
    store.close();
    process.exit(0);
  });

  await server.connect();
}

main().catch((err) => {
  log.error(err, 'Fatal error');
  process.exit(1);
});
