/**
 * `hesman grammars` (M1-05, ADR 0001 section 4.3): shows which Tree-sitter
 * grammars are bundled, cached or available on demand, and fills the cache —
 * from the pinned URLs of `grammars.json`, or from a directory for machines
 * without network access. Every file passes the same sha256 check.
 */
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { grammarStore, loadGrammarManifest, type GrammarEntry, type GrammarStore } from '../parsers/grammar-store.js';
import { splitArgs } from './args.js';

export interface GrammarsIo {
  out(line: string): void;
}

/** Decimal units, as `npm pack` prints sizes. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const sum = (entries: readonly GrammarEntry[]): number => entries.reduce((total, entry) => total + entry.bytes, 0);

function usage(): string {
  let onDemand: GrammarEntry[] = [];
  try {
    onDemand = Object.values(loadGrammarManifest().grammars).filter((entry) => !entry.bundled);
  } catch {
    // The usage text is still useful without the numbers.
  }
  return `Usage:
  hesman grammars list [--json]              Bundled, cached and on-demand grammars with their sizes
  hesman grammars install <language…>        Download these grammars into the cache
  hesman grammars install --all              Download every on-demand grammar
                                             (${onDemand.length} grammars, ${formatSize(sum(onDemand))} in total)
  hesman grammars install --from <directory> [language…]
                                             Install from .wasm files copied by hand (no network)

Grammars are pinned by URL and sha256 in grammars.json; a file that does not match is never
cached. The server downloads a missing grammar by itself when a project needs it, unless
HESMAN_GRAMMARS_OFFLINE=1 or the config key "grammars": { "offline": true } is set.`;
}

type ListState = 'bundled' | 'cached' | 'available';

interface ListRow {
  id: string;
  state: ListState;
  bytes: number;
  abi: number;
  /** True when a tags query is vendored: the grammar yields symbols. False: its files stay on the text tier. */
  symbols: boolean;
  extensions?: string[];
  license: string;
  repo: string;
  rev: string;
  url: string;
  sha256: string;
  /** The cached file, when cached. */
  path?: string;
}

function listRows(store: GrammarStore): ListRow[] {
  return store.ids().map((id) => {
    const entry = store.entry(id)!;
    const path = entry.bundled ? null : store.availablePath(id);
    return {
      id,
      state: entry.bundled ? 'bundled' : path ? 'cached' : 'available',
      bytes: entry.bytes,
      abi: entry.abi,
      symbols: entry.queries !== undefined,
      ...(entry.extensions ? { extensions: entry.extensions } : {}),
      license: entry.source.license,
      repo: entry.source.repo,
      rev: entry.source.rev,
      url: entry.url,
      sha256: entry.sha256,
      ...(path ? { path } : {}),
    };
  });
}

function runList(flags: Set<string>, io: GrammarsIo, store: GrammarStore): number {
  const rows = listRows(store);
  const of = (state: ListState): ListRow[] => rows.filter((row) => row.state === state);
  const bytesOf = (selected: readonly ListRow[]): number => selected.reduce((total, row) => total + row.bytes, 0);
  const onDemand = rows.filter((row) => row.state !== 'bundled');
  const totals = {
    bundled: of('bundled').length,
    bundledBytes: bytesOf(of('bundled')),
    cached: of('cached').length,
    cachedBytes: bytesOf(of('cached')),
    onDemand: onDemand.length,
    onDemandBytes: bytesOf(onDemand),
  };

  if (flags.has('--json')) {
    io.out(JSON.stringify({ abi: store.manifest.abi, cacheDir: store.cacheDir, offline: store.offline, totals, grammars: rows }, null, 2));
    return 0;
  }

  const width = Math.max(8, ...rows.map((row) => row.id.length));
  io.out(`${'LANGUAGE'.padEnd(width)}  ${'STATE'.padEnd(9)}  ${'SIZE'.padStart(8)}  ABI  ${'INDEXED AS'.padEnd(9)}  SOURCE`);
  for (const row of rows) {
    io.out(
      `${row.id.padEnd(width)}  ${row.state.padEnd(9)}  ${formatSize(row.bytes).padStart(8)}  ${String(row.abi).padStart(3)}  ` +
        `${(row.symbols ? 'symbols' : 'text tier').padEnd(9)}  ${row.repo.replace('https://github.com/', '')}@${row.rev} (${row.license})`,
    );
  }
  io.out('');
  io.out(
    `${totals.bundled} bundled (${formatSize(totals.bundledBytes)}), ${totals.cached} cached (${formatSize(totals.cachedBytes)}), ` +
      `${totals.onDemand} on demand (${formatSize(totals.onDemandBytes)} to download all).`,
  );
  io.out('"text tier": no symbols query exists for this grammar yet, so its files are indexed as text and it is never downloaded automatically.');
  io.out(`Cache: ${store.cacheDir}${store.offline ? ' (offline: downloads are disabled)' : ''}`);
  return 0;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function installFrom(directory: string, ids: string[], io: GrammarsIo, store: GrammarStore): number {
  if (!isDirectory(directory)) {
    io.out(`${directory} is not a directory.`);
    return 1;
  }
  const results = store.installFromDirectory(directory, ids.length > 0 ? ids : undefined);
  if (results.length === 0) {
    io.out(`No grammar of the catalog was found in ${directory}. Files must keep their release name, for example tree-sitter-scala.wasm.`);
    return 1;
  }
  let failed = 0;
  for (const { id, result } of results) {
    const entry = store.entry(id)!;
    if (result === 'installed') io.out(`${id}: installed from ${directory} (${formatSize(entry.bytes)})`);
    else if (result === 'present') io.out(`${id}: ${entry.bundled ? 'bundled' : 'already cached'}`);
    else {
      failed++;
      io.out(
        result === 'not-found'
          ? `${id}: failed — ${entry.file} not found in ${directory}`
          : `${id}: failed — the file does not match the pinned sha256 ${entry.sha256}`,
      );
    }
  }
  return failed > 0 ? 1 : 0;
}

async function runInstall(args: string[], io: GrammarsIo, store: GrammarStore): Promise<number> {
  const { positionals, flags, values } = splitArgs(args, ['--from']);
  const unknown = positionals.filter((id) => !store.entry(id));
  if (unknown.length > 0) {
    for (const id of unknown) io.out(`"${id}" is not in the grammar catalog.`);
    io.out('Run "hesman grammars list" to see the languages that can be installed.');
    return 1;
  }

  const from = values.get('--from');
  if (from !== undefined) return installFrom(resolve(from), positionals, io, store);
  if (flags.has('--from')) {
    io.out('--from needs a directory.');
    return 1;
  }

  let ids = positionals;
  if (flags.has('--all')) {
    ids = store.ids().filter((id) => !store.entry(id)!.bundled);
    const missing = ids.filter((id) => !store.availablePath(id));
    const bytes = missing.reduce((total, id) => total + store.entry(id)!.bytes, 0);
    io.out(`Installing ${missing.length} grammar${missing.length === 1 ? '' : 's'} (${formatSize(bytes)} to download) into ${store.cacheDir}`);
  } else if (ids.length === 0) {
    io.out(usage());
    return 1;
  }

  let installed = 0;
  let present = 0;
  let failed = 0;
  for (const id of ids) {
    const entry = store.entry(id)!;
    try {
      if ((await store.install(id)) === 'downloaded') {
        installed++;
        io.out(`${id}: downloaded (${formatSize(entry.bytes)})`);
      } else {
        present++;
        io.out(`${id}: ${entry.bundled ? 'bundled' : 'already cached'}`);
      }
    } catch (err) {
      failed++;
      io.out(`${id}: failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (flags.has('--all')) io.out(`${installed} installed, ${present} already present, ${failed} failed.`);
  return failed > 0 ? 1 : 0;
}

/** Runs `hesman grammars …` and returns the exit code. */
export async function runGrammars(args: string[], io: GrammarsIo, store: GrammarStore = grammarStore()): Promise<number> {
  const [subcommand, ...rest] = args;
  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    io.out(usage());
    return 0;
  }
  if (subcommand === undefined || subcommand === 'list' || subcommand === '--json') {
    return runList(new Set(args), io, store);
  }
  if (subcommand === 'install') return runInstall(rest, io, store);
  io.out(`Unknown subcommand "${subcommand}".\n\n${usage()}`);
  return 1;
}
