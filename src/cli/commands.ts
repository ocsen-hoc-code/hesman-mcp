import { resolve, join } from 'node:path';
import { readFileSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs';
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
  console.log(`hesman v1.0.0 — Next-gen MCP server for deep code intelligence

Usage:
  hesman                    Run the MCP server (stdio transport)
  hesman index [path]       Index a project (default: current directory)
  hesman status [path]      Show indexing status
  hesman clean [path]       Delete .hesman/ data directory
  hesman clean --force      Skip confirmation prompt
  hesman clean --dry-run    Preview what would be deleted
  hesman diag [path]        Print diagnostics to terminal
  hesman diag --json        JSON format output
  hesman install --agent <claude|cursor|vscode> [--global]
  hesman --version, -v      Print version
  hesman --help, -h         Show this help

MCP tools (available when server is running):
  find_symbol            Look up symbols by name (exact / fuzzy / prefix)
  get_file_structure     List all symbols in a file
  get_references         Find references to a symbol across the codebase
  get_callers            Traverse the call graph upward (who calls this?)
  get_callees            Traverse the call graph downward (what does this call?)
  get_context            Retrieve focused code context around a location (with pruning)
  semantic_search        Natural-language search over indexed code
  list_dependencies      List external and internal dependencies
  impact_analysis        Analyze what breaks if a symbol changes (rename / delete / signature)
  find_pattern           Search for code patterns using AST queries
  index_status           Report indexing health and statistics

Supported languages: TypeScript, JavaScript, Python, Go
`);
}

export async function runInstall(args: string[]): Promise<void> {
  const { installAgent } = await import('./install');

  let agent = '';
  let global = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1]) {
      agent = args[++i];
    } else if (args[i] === '--global') {
      global = true;
    }
  }

  if (!agent) {
    console.log('Usage: hesman install --agent <claude|cursor|vscode> [--global]');
    process.exit(1);
  }

  const projectRoot = process.cwd();
  installAgent(agent, projectRoot, global);
}

function getDirSize(dir: string): number {
  let size = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(full);
      } else {
        size += statSync(full).size;
      }
    }
  } catch {
    // Skip permission errors
  }
  return size;
}

function getFileCount(dir: string): number {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += getFileCount(full);
      } else {
        count++;
      }
    }
  } catch {
    // Skip permission errors
  }
  return count;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function runClean(args: string[]): Promise<void> {
  const config = loadConfig();
  const projectRoot = resolve(args[0] || config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');

  if (!existsSync(dataDir)) {
    console.log(`Nothing to clean. ${dataDir} does not exist.`);
    return;
  }

  const size = getDirSize(dataDir);
  const fileCount = getFileCount(dataDir);

  if (dryRun) {
    console.log(`Would delete: ${dataDir}`);
    console.log(`  Size: ${formatBytes(size)}`);
    console.log(`  Files: ${fileCount}`);
    return;
  }

  if (!force) {
    console.log(`About to delete: ${dataDir}`);
    console.log(`  Size: ${formatBytes(size)}`);
    console.log(`  Files: ${fileCount}`);
    console.log(`Run "hesman clean --force" to confirm.`);
    return;
  }

  // Actually delete
  rmSync(dataDir, { recursive: true });
  console.log(`Cleaned. Deleted ${formatBytes(size)} in ${fileCount} files.`);
}

export async function runDiag(args: string[]): Promise<void> {
  const config = loadConfig();
  const projectRoot = resolve(args[0] || config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);

  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

  const diag = {
    version: pkg.version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: Math.round(process.uptime()),
    memory: {
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      externalMB: Math.round(process.memoryUsage().external / 1024 / 1024),
    },
    config: {
      projectRoot: config.projectRoot,
      workers: config.workers,
      watchMode: config.watchMode,
      semanticSearch: config.semanticSearch.enabled,
    },
    store: null as {
      totalFiles: number;
      totalSymbols: number;
      totalRelations: number;
      dbSizeBytes: number;
      lastIndexTime: string | null;
    } | null,
  };

  // If data dir exists, query store stats
  const dbPath = join(dataDir, 'symbols.db');
  if (existsSync(dbPath)) {
    const store = new SqliteStore(dataDir);
    store.open();
    try {
      const stats = store.getStats();
      diag.store = {
        totalFiles: stats.totalFiles,
        totalSymbols: stats.totalSymbols,
        totalRelations: store.getTotalRelations(),
        dbSizeBytes: statSync(dbPath).size,
        lastIndexTime: stats.lastIndexTime ? new Date(stats.lastIndexTime).toISOString() : null,
      };
    } finally {
      store.close();
    }
  }

  const asJson = args.includes('--json');
  if (asJson) {
    console.log(JSON.stringify(diag, null, 2));
  } else {
    console.log(`hesman v${diag.version} — Diagnostics`);
    console.log(`──────────────────────────────────────`);
    console.log(`Runtime: Node ${diag.node} | ${diag.platform} ${diag.arch}`);
    console.log(`Uptime:  ${diag.uptime}s`);
    console.log(`Memory:  heap ${diag.memory.heapUsedMB}/${diag.memory.heapTotalMB}MB | rss ${diag.memory.rssMB}MB`);
    console.log(``);
    console.log(`Config:`);
    console.log(`  project:  ${diag.config.projectRoot}`);
    console.log(`  workers:  ${diag.config.workers === 0 ? 'auto' : diag.config.workers}`);
    console.log(`  watch:    ${diag.config.watchMode ? 'on' : 'off'}`);
    console.log(`  semantic: ${diag.config.semanticSearch ? 'on' : 'off'}`);
    if (diag.store) {
      console.log(``);
      console.log(`Store:`);
      console.log(`  files:     ${diag.store.totalFiles}`);
      console.log(`  symbols:   ${diag.store.totalSymbols}`);
      console.log(`  relations: ${diag.store.totalRelations}`);
      console.log(`  db size:   ${formatBytes(diag.store.dbSizeBytes)}`);
      if (diag.store.lastIndexTime) {
        console.log(`  indexed:   ${diag.store.lastIndexTime}`);
      } else {
        console.log(`  indexed:   never`);
      }
    }
  }
}
