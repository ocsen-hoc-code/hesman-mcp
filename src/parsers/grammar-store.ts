/**
 * Grammar delivery (M1-05, ADR 0001 sections 4.1-4.3).
 *
 * `grammars.json` at the package root pins every Tree-sitter grammar Hesman
 * may load: the bundled core set (files in `parsers/`) and a catalog fetched
 * on demand into a per-user cache. This module is the only place that knows
 * the cache layout, downloads a grammar or decides whether one is available.
 *
 * Rules it enforces:
 * - The manifest is the only source of URLs. Nothing is fetched that is not
 *   pinned there by URL, size and sha256.
 * - Bytes are verified before they are written (temporary file, then rename)
 *   and a cached file is hashed again before it is used; a file that does not
 *   match is deleted and counts as missing.
 * - Downloads run in the background (`request`) and never throw into the
 *   caller. Offline mode (`HESMAN_GRAMMARS_OFFLINE=1` or the `grammars.offline`
 *   config key) disables every download; cached grammars keep working.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, verifyChecksum } from '../utils/checksum.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('grammars');

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The shipped manifest; the same file from `src/` and from `dist/`. */
export const MANIFEST_PATH = join(PACKAGE_ROOT, 'grammars.json');
const BUNDLED_PARSERS_DIR = join(PACKAGE_ROOT, 'parsers');

/** How long one download may take before it is abandoned. */
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
/** A failed background download is not tried again before this much time has passed. */
const RETRY_AFTER_MS = 10 * 60_000;

export interface GrammarSource {
  /** Repository the release asset comes from. */
  repo: string;
  /** Release tag. */
  rev: string;
  /** Commit the tag points at, when recorded. */
  commit?: string;
  /** SPDX license identifier of the grammar. */
  license: string;
}

export interface GrammarEntry {
  /** True for the core set shipped in `parsers/`; false for a grammar fetched on demand. */
  bundled: boolean;
  /** Name of the upstream release asset (and of the file in `parsers/` when bundled). */
  file: string;
  url: string;
  /** sha256 of the `.wasm` bytes. */
  sha256: string;
  bytes: number;
  /** Tree-sitter ABI version of the grammar. */
  abi: number;
  source: GrammarSource;
  /** Extensions (lowercase, leading dot) parsed with this grammar. Only on entries that have a tags query. */
  extensions?: string[];
  /** Vendored query files, as paths relative to the package root. Absent: the grammar yields no symbols. */
  queries?: { tags: string[] };
}

export interface GrammarManifest {
  /** ABI range of the pinned `web-tree-sitter` runtime. */
  abi: { min: number; max: number };
  grammars: Record<string, GrammarEntry>;
}

/** Fetch as the store needs it; the real `fetch` satisfies it, and tests inject their own. */
export type GrammarFetch = (url: string, init: { signal: AbortSignal; redirect?: 'manual' }) => Promise<Response>;

export type GrammarMissingReason = 'offline' | 'downloading' | 'download-failed' | 'not-downloaded' | 'not-in-catalog';

export interface GrammarStatus {
  state: 'bundled' | 'cached' | 'missing';
  /** Why a missing grammar is missing. */
  reason?: GrammarMissingReason;
  /** The error of a failed download. */
  detail?: string;
}

export interface GrammarStoreOptions {
  manifest?: GrammarManifest;
  /** Directory that holds `hesman/grammars/`. Default: `resolveCacheRoot()`. */
  cacheRoot?: string;
  /** Directory of the bundled grammars. Default: `parsers/` of this installation. */
  parsersDir?: string;
  fetch?: GrammarFetch;
  /** True disables every download. Default: `HESMAN_GRAMMARS_OFFLINE`. */
  offline?: boolean;
  timeoutMs?: number;
}

export interface DirectoryInstallResult {
  id: string;
  result: 'installed' | 'present' | 'not-found' | 'checksum-mismatch';
}

/** Reads and parses the manifest shipped with this installation. */
export function loadGrammarManifest(path: string = MANIFEST_PATH): GrammarManifest {
  return JSON.parse(readFileSync(path, 'utf-8')) as GrammarManifest;
}

/**
 * The per-user cache root (ADR 0001, 4.2): `HESMAN_CACHE_DIR`, else an absolute
 * `XDG_CACHE_HOME`, else the platform's cache directory.
 */
export function resolveCacheRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.HESMAN_CACHE_DIR) return env.HESMAN_CACHE_DIR;
  if (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME)) return env.XDG_CACHE_HOME;
  if (platform === 'darwin') return join(home, 'Library', 'Caches');
  if (platform === 'win32') return env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  return join(home, '.cache');
}

/** True when the environment turns grammar downloads off. */
export function grammarsOfflineFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HESMAN_GRAMMARS_OFFLINE === '1' || env.HESMAN_GRAMMARS_OFFLINE === 'true';
}

/** Hosts a pinned download may be redirected to (GitHub serves release assets from its CDN). */
const REDIRECT_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const MAX_REDIRECTS = 3;

/**
 * The production fetch: HTTPS only, and a redirect is followed only to a
 * known GitHub download host, so a pinned URL cannot be bounced elsewhere.
 */
export const pinnedFetch: GrammarFetch = async (url, init) => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, { signal: init.signal, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error(`Redirect without a location from ${new URL(current).host}`);
    const next = new URL(location, current);
    if (next.protocol !== 'https:' || !REDIRECT_HOSTS.has(next.host)) {
      throw new Error(`Refusing a redirect to ${next.protocol}//${next.host}`);
    }
    current = next.href;
  }
  throw new Error('Too many redirects');
};

/** Reads a response body, failing as soon as it grows past `limit` bytes. */
async function readBody(response: Response, limit: number, name: string): Promise<Buffer> {
  const tooLarge = (): Error => new Error(`Download of ${name} is larger than the pinned ${limit} bytes`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class GrammarStore {
  readonly manifest: GrammarManifest;
  /** `<cacheRoot>/hesman/grammars/abi-<max>`: one directory per runtime ABI range. */
  readonly cacheDir: string;
  private readonly parsersDir: string;
  private readonly fetchFn: GrammarFetch;
  private readonly offlineOption: boolean | undefined;
  private readonly timeoutMs: number;
  /** Cached files already hashed by this process, with the stat they had then. */
  private readonly verified = new Map<string, { size: number; mtimeMs: number }>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, { detail: string; at: number }>();

  constructor(options: GrammarStoreOptions = {}) {
    this.manifest = options.manifest ?? loadGrammarManifest();
    this.cacheDir = join(options.cacheRoot ?? resolveCacheRoot(), 'hesman', 'grammars', `abi-${this.manifest.abi.max}`);
    this.parsersDir = options.parsersDir ?? BUNDLED_PARSERS_DIR;
    this.fetchFn = options.fetch ?? pinnedFetch;
    this.offlineOption = options.offline;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  }

  /** True when downloads are disabled, by option or by `HESMAN_GRAMMARS_OFFLINE`. */
  get offline(): boolean {
    return this.offlineOption ?? grammarsOfflineFromEnv();
  }

  /** Ids of every grammar in the manifest, in manifest order. */
  ids(): string[] {
    return Object.keys(this.manifest.grammars);
  }

  entry(id: string): GrammarEntry | undefined {
    return Object.prototype.hasOwnProperty.call(this.manifest.grammars, id) ? this.manifest.grammars[id] : undefined;
  }

  private required(id: string): GrammarEntry {
    const entry = this.entry(id);
    if (!entry) throw new Error(`"${id}" is not in the grammar catalog`);
    return entry;
  }

  /** Where the grammar is (or would be) cached. The hash in the name keeps revisions apart. */
  cachePath(id: string): string {
    return join(this.cacheDir, `${id}-${this.required(id).sha256.slice(0, 12)}.wasm`);
  }

  /** Reads and hashes the cached file; deletes it when it does not match. Returns the verified bytes, or null. */
  private readVerified(id: string, entry: GrammarEntry, path: string): Buffer | null {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      this.verified.delete(id);
      return null;
    }
    if (bytes.length === entry.bytes && sha256(bytes) === entry.sha256) {
      try {
        const st = statSync(path);
        this.verified.set(id, { size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        this.verified.delete(id);
      }
      return bytes;
    }
    log.warn({ language: id, path }, 'Cached grammar does not match its pinned sha256; deleting it');
    this.verified.delete(id);
    rmSync(path, { force: true });
    return null;
  }

  /** Hashes the cached file; deletes it when it does not match. */
  private verifyCached(id: string, entry: GrammarEntry, path: string): boolean {
    return this.readVerified(id, entry, path) !== null;
  }

  /**
   * The grammar file to parse with, or `null` when the grammar is not there.
   * A cached file is hashed the first time this process sees it and again
   * whenever its size or modification time changes, so the check is cheap
   * enough to run for every scanned file.
   */
  availablePath(id: string): string | null {
    const entry = this.entry(id);
    if (!entry) return null;
    if (entry.bundled) return join(this.parsersDir, entry.file);
    const path = this.cachePath(id);
    let st;
    try {
      st = statSync(path);
    } catch {
      this.verified.delete(id);
      return null;
    }
    const seen = this.verified.get(id);
    if (seen && seen.size === st.size && seen.mtimeMs === st.mtimeMs) return path;
    return this.verifyCached(id, entry, path) ? path : null;
  }

  /**
   * The grammar file, hashed now. Called right before a grammar is loaded
   * into the runtime; throws when the grammar is missing or was tampered with.
   */
  verifiedPath(id: string): string {
    const entry = this.required(id);
    if (entry.bundled) return join(this.parsersDir, entry.file);
    const path = this.cachePath(id);
    if (!this.verifyCached(id, entry, path)) throw new Error(`The ${id} grammar is not available in ${this.cacheDir}`);
    return path;
  }

  /**
   * The bytes of a cached on-demand grammar, hashed now. This is what the
   * runtime loads: the file is read once, so it cannot change between the
   * check and the load. Throws when the grammar is missing or does not match.
   */
  verifiedBytes(id: string): Uint8Array {
    const entry = this.required(id);
    if (entry.bundled) throw new Error(`The ${id} grammar is bundled; it is loaded from ${this.parsersDir}`);
    const bytes = this.readVerified(id, entry, this.cachePath(id));
    if (!bytes) throw new Error(`The ${id} grammar is not available in ${this.cacheDir}`);
    return bytes;
  }

  status(id: string): GrammarStatus {
    const entry = this.entry(id);
    if (!entry) return { state: 'missing', reason: 'not-in-catalog' };
    if (entry.bundled) return { state: 'bundled' };
    if (this.availablePath(id)) return { state: 'cached' };
    if (this.inFlight.has(id)) return { state: 'missing', reason: 'downloading' };
    if (this.offline) return { state: 'missing', reason: 'offline' };
    const failure = this.failures.get(id);
    if (failure) return { state: 'missing', reason: 'download-failed', detail: failure.detail };
    return { state: 'missing', reason: 'not-downloaded' };
  }

  /** Verified bytes -> cache, atomically. */
  private writeCached(id: string, bytes: Buffer): void {
    const path = this.cachePath(id);
    mkdirSync(this.cacheDir, { recursive: true });
    const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(temporary, bytes);
      renameSync(temporary, path);
    } catch (err) {
      rmSync(temporary, { force: true });
      throw err;
    }
    const st = statSync(path);
    this.verified.set(id, { size: st.size, mtimeMs: st.mtimeMs });
    this.failures.delete(id);
    this.writeNotice();
  }

  /** Attribution of the cached grammars, next to them (ADR 0001, 4.5). Best effort. */
  private writeNotice(): void {
    const lines = [
      'Tree-sitter grammars downloaded by Hesman (hesman-mcp).',
      'Each file is the unmodified .wasm asset of the release named below, under the license of its repository.',
      '',
    ];
    for (const id of this.ids()) {
      const entry = this.manifest.grammars[id];
      if (entry.bundled || !existsSync(this.cachePath(id))) continue;
      lines.push(
        `${id}-${entry.sha256.slice(0, 12)}.wasm`,
        `  Repository: ${entry.source.repo}`,
        `  Revision:   ${entry.source.rev}${entry.source.commit ? ` (${entry.source.commit})` : ''}`,
        `  License:    ${entry.source.license} (see the LICENSE file of the repository at that revision)`,
        `  sha256:     ${entry.sha256}`,
        '',
      );
    }
    try {
      writeFileSync(join(this.cacheDir, 'NOTICE.txt'), lines.join('\n'));
    } catch (err) {
      log.debug({ error: messageOf(err) }, 'Could not write the grammar cache notice');
    }
  }

  private async download(id: string, entry: GrammarEntry): Promise<void> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error(`Download of ${id} timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
    try {
      const response = await this.fetchFn(entry.url, { signal: abort.signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Failed to download ${id}: HTTP ${response.status}`);
      }
      const bytes = await readBody(response, entry.bytes, id);
      verifyChecksum(bytes, entry.sha256, id);
      this.writeCached(id, bytes);
      log.info({ language: id, bytes: bytes.length }, 'Grammar downloaded and verified');
    } catch (err) {
      this.failures.set(id, { detail: messageOf(err), at: Date.now() });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private startDownload(id: string, entry: GrammarEntry): Promise<void> {
    let pending = this.inFlight.get(id);
    if (!pending) {
      pending = this.download(id, entry).finally(() => this.inFlight.delete(id));
      this.inFlight.set(id, pending);
      // The same promise is awaited by install(); a background caller never looks at it.
      pending.catch(() => {});
    }
    return pending;
  }

  /**
   * Makes sure the grammar is on disk. `present`: bundled or already cached.
   * Throws when offline, when the id is unknown, and when the download fails
   * or does not match its pin.
   */
  async install(id: string): Promise<'present' | 'downloaded'> {
    const entry = this.required(id);
    if (entry.bundled || this.availablePath(id)) return 'present';
    if (this.offline) {
      throw new Error(`Grammar downloads are disabled (offline mode): cannot fetch ${id}. Use "hesman grammars install --from <directory>".`);
    }
    await this.startDownload(id, entry);
    return 'downloaded';
  }

  /**
   * Starts background downloads for the missing grammars among `ids` and
   * returns the ids now being downloaded. Never throws and never waits:
   * bundled, cached, unknown and recently failed grammars are skipped, and so
   * is everything in offline mode.
   */
  request(ids: Iterable<string>): string[] {
    const started: string[] = [];
    for (const id of new Set(ids)) {
      const entry = this.entry(id);
      if (!entry || entry.bundled || this.offline) continue;
      if (this.inFlight.has(id)) {
        started.push(id);
        continue;
      }
      if (this.availablePath(id)) continue;
      const failure = this.failures.get(id);
      if (failure && Date.now() - failure.at < RETRY_AFTER_MS) continue;
      this.startDownload(id, entry).catch((err) => {
        log.warn({ language: id, error: messageOf(err) }, 'Grammar download failed; its files stay on the text tier');
      });
      started.push(id);
    }
    return started;
  }

  /** Resolves when every download in flight has ended, successfully or not. Never rejects. */
  async settled(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  /**
   * Air-gapped install: copies grammars from `directory` into the cache after
   * the same sha256 check. A grammar is looked up by its upstream asset name
   * (`tree-sitter-zig.wasm`) or its cache name (`zig-<sha12>.wasm`). Without
   * `ids`, every on-demand grammar found in the directory is installed.
   */
  installFromDirectory(directory: string, ids?: readonly string[]): DirectoryInstallResult[] {
    const results: DirectoryInstallResult[] = [];
    for (const id of ids ?? this.ids()) {
      const entry = this.required(id);
      if (entry.bundled) {
        if (ids) results.push({ id, result: 'present' });
        continue;
      }
      const candidates = [join(directory, entry.file), join(directory, `${id}-${entry.sha256.slice(0, 12)}.wasm`)];
      const source = candidates.find((candidate) => existsSync(candidate));
      if (!source) {
        if (ids) results.push({ id, result: 'not-found' });
        continue;
      }
      if (this.availablePath(id)) {
        results.push({ id, result: 'present' });
        continue;
      }
      const bytes = readFileSync(source);
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
        results.push({ id, result: 'checksum-mismatch' });
        continue;
      }
      this.writeCached(id, bytes);
      results.push({ id, result: 'installed' });
    }
    return results;
  }
}

let shared: GrammarStore | undefined;
let sharedOptions: GrammarStoreOptions = {};

/**
 * The store of this process (or worker thread), created on first use from the
 * shipped manifest and the environment.
 */
export function grammarStore(): GrammarStore {
  shared ??= new GrammarStore(sharedOptions);
  return shared;
}

/**
 * Replaces options of the shared store (the offline switch from the config,
 * or a fetch function). Options set earlier are kept; `undefined` clears one.
 */
export function configureGrammarStore(options: GrammarStoreOptions): GrammarStore {
  const next = { ...sharedOptions, ...options };
  const unchanged =
    shared !== undefined
    && (Object.keys(next) as Array<keyof GrammarStoreOptions>).every((key) => next[key] === sharedOptions[key]);
  sharedOptions = next;
  if (!unchanged) shared = new GrammarStore(sharedOptions);
  return grammarStore();
}

/**
 * What `Language.load` gets for a profile: the `parsers/` path of a bundled
 * language, or the bytes of the cached grammar (hashed again now) for a
 * language fetched on demand.
 */
export function grammarSourceFor(profile: { language: string; parserWasmPath: string }): string | Uint8Array {
  const store = grammarStore();
  const entry = store.entry(profile.language);
  return entry && !entry.bundled ? store.verifiedBytes(profile.language) : profile.parserWasmPath;
}
