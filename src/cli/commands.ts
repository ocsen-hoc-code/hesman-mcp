import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../config/loader';
import { SqliteStore } from '../stores/sqlite';
import { indexProject } from '../indexing/index-coordinator';

export async function runIndex(args: string[]): Promise<void> {
  const config = loadConfig();
  const projectRoot = resolve(args[0] || config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);
  const store = new SqliteStore(dataDir);

  store.open();
  try {
    console.log(`Indexing project at ${projectRoot}...`);
    const result = await indexProject(projectRoot, store, config);
    console.log(`Done. ${result.filesScanned} files scanned, ${result.filesIndexed} indexed, ${result.symbolsFound} symbols found.`);
    console.log(`Took ${result.tookMs}ms`);
    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}):`);
      for (const err of result.errors) console.log(`  ${err}`);
    }
  } finally {
    store.close();
  }
}

export async function runStatus(args: string[]): Promise<void> {
  const config = loadConfig();
  const projectRoot = resolve(args[0] || config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);
  const store = new SqliteStore(dataDir);

  store.open();
  try {
    const stats = store.getStats();
    console.log(`Project: ${projectRoot}`);
    console.log(`Data directory: ${dataDir}`);
    console.log(`Files indexed: ${stats.totalFiles}`);
    console.log(`Symbols: ${stats.totalSymbols}`);
    if (stats.lastIndexTime) {
      console.log(`Last index: ${new Date(stats.lastIndexTime).toISOString()}`);
    } else {
      console.log('Last index: never');
    }
  } finally {
    store.close();
  }
}

export function printVersion(): void {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  console.log(`hesman v${pkg.version}`);
}

export function printHelp(): void {
  console.log(`hesman — Next-gen MCP server for deep code intelligence

Usage:
  hesman                    Run the MCP server (stdio transport)
  hesman index [path]       Index a project (default: current directory)
  hesman status [path]      Show indexing status
  hesman --version          Print version
  hesman --help             Show this help
`);
}
