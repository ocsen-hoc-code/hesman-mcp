import { resolve, join, relative, isAbsolute, parse, sep } from 'node:path';
import { readFileSync, existsSync, rmSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { getHeapStatistics } from 'node:v8';
import { loadConfig } from '../config/loader.js';
import { SqliteStore } from '../stores/sqlite.js';
import { indexProject, waitForRequestedGrammars, type IndexResult } from '../indexing/index-coordinator.js';
import { configureGrammarStore } from '../parsers/grammar-store.js';
import { splitArgs } from './args.js';

/** The project root is the first positional argument; flags never count as a path. */
function projectRootFrom(positionals: string[], fallback: string): string {
  return resolve(positionals[0] || fallback);
}

export async function runIndex(args: string[]): Promise<void> {
  const config = loadConfig();
  const { positionals } = splitArgs(args);
  const projectRoot = projectRootFrom(positionals, config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);
  const store = new SqliteStore(dataDir);

  store.open();
  try {
    if (config.grammars.offline) configureGrammarStore({ offline: true });
    const report = (result: IndexResult): void => {
      console.log(`Done. ${result.filesScanned} files scanned, ${result.filesIndexed} indexed, ${result.symbolsFound} symbols found.`);
      console.log(`Took ${result.tookMs}ms`);
      if (result.errors.length > 0) {
        console.log(`\nErrors (${result.errors.length}):`);
        for (const err of result.errors) console.log(`  ${err}`);
      }
    };
    console.log(`Indexing project at ${projectRoot}...`);
    const result = await indexProject(projectRoot, store, config);
    report(result);
    // Files of an on-demand language were indexed as text; parse them once the grammar is here.
    if (result.grammarsRequested.length > 0) {
      console.log(`\nDownloading grammars: ${result.grammarsRequested.join(', ')}...`);
      const arrived = await waitForRequestedGrammars(result.grammarsRequested);
      const failed = result.grammarsRequested.filter((id) => !arrived.includes(id));
      if (failed.length > 0) console.log(`Not downloaded (files stay indexed as text): ${failed.join(', ')}`);
      if (arrived.length > 0) {
        console.log(`Re-indexing with: ${arrived.join(', ')}...`);
        report(await indexProject(projectRoot, store, config));
      }
    }
  } finally {
    store.close();
  }
}

export async function runStatus(args: string[]): Promise<void> {
  const config = loadConfig();
  const { positionals } = splitArgs(args);
  const projectRoot = projectRootFrom(positionals, config.projectRoot);
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
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  console.log(`hesman v${pkg.version} — Next-gen MCP server for deep code intelligence

Usage:
  hesman                    Run the MCP server (stdio transport)
  hesman index [path]       Index a project (default: current directory)
  hesman status [path]      Show indexing status
  hesman clean [path]       Delete .hesman/ data directory
  hesman clean --force      Skip confirmation prompt
  hesman clean --dry-run    Preview what would be deleted
  hesman diag [path]        Print diagnostics to terminal
  hesman diag --json        JSON format output
  hesman setup              Add Hesman to your AI clients (checklist of detected clients)
    --client <name…>        Configure these clients: claude-code, claude-desktop, codex, cursor,
                            antigravity, vscode, gemini-cli, windsurf
    --all                   Configure every supported client
    --yes                   No questions: configure the detected clients
    --dry-run               Print the exact change per client, write nothing
    --scope user|project    User-wide config (default) or a file in the current project
    --project-root <path>   Project for clients without a workspace (Claude Desktop)
    --command <how>         How clients start Hesman: auto (default), npx, global, absolute
    --rules                 Also add a short "when to use Hesman" block to the project's agent
                            instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, ...); opt-in,
                            and hesman remove deletes exactly that block again
  hesman remove             Remove Hesman from the clients again
                            (--client <name…>, --all, --scope, --dry-run)
  hesman doctor             Check each client's Hesman entry end to end (--client <name…>, --json, --timeout <ms>)
  hesman install --agent X  Deprecated alias of: hesman setup --client X --yes
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

Supported languages: TypeScript, TSX, JavaScript, Python, Go, Java, C, C++, C#, Rust, PHP, Ruby,
Kotlin, Swift, Bash, Lua (symbols); every other text file is indexed as text
`);
}

/** Real terminal + machine for the client commands; the logic lives in `clients/setup.ts`. */
async function runClientCommand(name: 'runSetup' | 'runRemove' | 'runInstall', args: string[]): Promise<void> {
  const setup = await import('./clients/setup.js');
  const { realEnvironment } = await import('./clients/environment.js');
  const code = await setup[name](args, {
    env: realEnvironment(),
    out: (line) => console.log(line),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: async (question) => {
      const { createInterface } = await import('node:readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await new Promise<string>((resolveAnswer) => rl.question(question, resolveAnswer));
      } finally {
        rl.close();
      }
    },
  });
  if (code !== 0) process.exitCode = code;
}

export function runSetup(args: string[]): Promise<void> {
  return runClientCommand('runSetup', args);
}

export function runRemove(args: string[]): Promise<void> {
  return runClientCommand('runRemove', args);
}

/** Deprecated alias of `hesman setup --client <agent> --yes`. */
export function runInstall(args: string[]): Promise<void> {
  return runClientCommand('runInstall', args);
}

/** `hesman doctor`: read-only checks of this installation and of each client's entry (`doctor/doctor.ts`). */
export async function runDoctor(args: string[]): Promise<void> {
  const { runDoctor: doctor } = await import('./doctor/doctor.js');
  const { realDoctorEnvironment } = await import('./doctor/environment.js');
  const { realEnvironment } = await import('./clients/environment.js');
  const code = await doctor(args, { env: realEnvironment(), out: (line) => console.log(line) }, realDoctorEnvironment());
  if (code !== 0) process.exitCode = code;
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

/** Marker file created by SqliteStore.open(); proves a directory is a Hesman data dir. */
const DATA_DIR_MARKER = 'symbols.db';

/** Resolve symlinks when the path exists so comparisons see the real location. */
function canonicalPath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}

function pathsEqual(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when `ancestor` strictly contains `child`. */
function isStrictAncestor(ancestor: string, child: string): boolean {
  const rel = relative(ancestor, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Returns the reason `hesman clean` must refuse to delete `dataDir`, or null
 * when the directory is safe to remove. `--force` never bypasses these checks.
 */
function cleanRefusalReason(dataDir: string, projectRoot: string): string | null {
  const data = canonicalPath(dataDir);
  const project = canonicalPath(projectRoot);

  if (pathsEqual(data, project)) {
    return `data directory ${dataDir} equals the project root`;
  }
  // Root and home are usually ancestors too; check them first for a precise message.
  if (pathsEqual(data, parse(data).root)) {
    return `data directory ${dataDir} is a filesystem root`;
  }
  if (pathsEqual(data, canonicalPath(homedir()))) {
    return `data directory ${dataDir} is the home directory`;
  }
  if (isStrictAncestor(data, project)) {
    return `data directory ${dataDir} is an ancestor of the project root ${projectRoot}`;
  }
  // An empty directory holds nothing to lose; anything else must carry the marker.
  if (readdirSync(dataDir).length > 0 && !existsSync(join(dataDir, DATA_DIR_MARKER))) {
    return `data directory ${dataDir} does not contain ${DATA_DIR_MARKER}, so it is not a Hesman data directory`;
  }
  return null;
}

export async function runClean(args: string[]): Promise<void> {
  const config = loadConfig();
  const { positionals, flags } = splitArgs(args);
  const projectRoot = projectRootFrom(positionals, config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);
  const force = flags.has('--force');
  const dryRun = flags.has('--dry-run');

  if (!existsSync(dataDir)) {
    console.log(`Nothing to clean. ${dataDir} does not exist.`);
    return;
  }

  const refusal = cleanRefusalReason(dataDir, projectRoot);
  if (refusal) {
    console.error(`Refusing to clean: ${refusal}.`);
    process.exitCode = 1;
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
  const { positionals, flags } = splitArgs(args);
  const projectRoot = projectRootFrom(positionals, config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);

  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  const heapStats = getHeapStatistics();

  const diag: {
    version: string;
    node: string;
    platform: string;
    arch: string;
    uptime: number;
    memory: {
      heapUsedMB: number;
      heapTotalMB: number;
      rssMB: number;
      externalMB: number;
    };
    gc: {
      totalHeapMB: number;
      usedHeapMB: number;
      heapLimitMB: number;
      totalAvailableMB: number;
    };
    config: {
      projectRoot: string;
      workers: number;
      watchMode: boolean;
      semanticSearch: boolean;
    };
    store: {
      totalFiles: number;
      totalSymbols: number;
      totalRelations: number;
      dbSizeBytes: number;
      lastIndexTime: string | null;
    } | null;
    cache: {
      hits: number;
      misses: number;
      hitRate: number;
      status: string;
    };
    queryLatency: {
      avgMs: number;
      p95Ms: number;
      count: number;
      status: string;
    };
    watcher: {
      enabled: boolean;
      running: boolean;
      pendingFiles: number;
    };
    workerPool: {
      configured: number | string;
      activeWorkers: number;
      pendingTasks: number;
    };
  } = {
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
    gc: {
      totalHeapMB: Math.round(heapStats.total_heap_size / 1024 / 1024),
      usedHeapMB: Math.round(heapStats.used_heap_size / 1024 / 1024),
      heapLimitMB: Math.round(heapStats.heap_size_limit / 1024 / 1024),
      totalAvailableMB: Math.round(heapStats.total_available_size / 1024 / 1024),
    },
    config: {
      projectRoot: config.projectRoot,
      workers: config.workers,
      watchMode: config.watchMode,
      semanticSearch: config.semanticSearch.enabled,
    },
    store: null,
    cache: {
      hits: 0,
      misses: 0,
      hitRate: 0,
      status: 'N/A (server not running)',
    },
    queryLatency: {
      avgMs: 0,
      p95Ms: 0,
      count: 0,
      status: 'N/A (server not running)',
    },
    watcher: {
      enabled: config.watchMode,
      running: false,
      pendingFiles: 0,
    },
    workerPool: {
      configured: config.workers === 0 ? 'auto' : config.workers,
      activeWorkers: 0,
      pendingTasks: 0,
    },
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

  const asJson = flags.has('--json');
  if (asJson) {
    console.log(JSON.stringify(diag, null, 2));
  } else {
    console.log(`hesman v${diag.version} — Diagnostics`);
    console.log(`──────────────────────────────────────`);
    console.log(`Runtime: Node ${diag.node} | ${diag.platform} ${diag.arch}`);
    console.log(`Uptime:  ${diag.uptime}s`);
    console.log(`Memory:  heap ${diag.memory.heapUsedMB}/${diag.memory.heapTotalMB}MB | rss ${diag.memory.rssMB}MB`);
    console.log(`GC:      total ${diag.gc.totalHeapMB}MB | used ${diag.gc.usedHeapMB}MB | limit ${diag.gc.heapLimitMB}MB`);
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
    console.log(``);
    console.log(`Cache:`);
    console.log(`  hits:    ${diag.cache.hits}`);
    console.log(`  misses:  ${diag.cache.misses}`);
    console.log(`  rate:    ${diag.cache.hitRate}`);
    console.log(`  status:  ${diag.cache.status}`);
    console.log(``);
    console.log(`Query Latency:`);
    console.log(`  avg:     ${diag.queryLatency.avgMs}ms`);
    console.log(`  p95:     ${diag.queryLatency.p95Ms}ms`);
    console.log(`  count:   ${diag.queryLatency.count}`);
    console.log(`  status:  ${diag.queryLatency.status}`);
    console.log(``);
    console.log(`Watcher:`);
    console.log(`  enabled:      ${diag.watcher.enabled ? 'yes' : 'no'}`);
    console.log(`  running:      ${diag.watcher.running ? 'yes' : 'no'}`);
    console.log(`  pending:      ${diag.watcher.pendingFiles}`);
    console.log(``);
    console.log(`Worker Pool:`);
    console.log(`  configured:   ${diag.workerPool.configured}`);
    console.log(`  active:       ${diag.workerPool.activeWorkers}`);
    console.log(`  pending:      ${diag.workerPool.pendingTasks}`);
  }
}
