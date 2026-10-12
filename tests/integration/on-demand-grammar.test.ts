/**
 * On-demand grammars end to end, without the network (M1-05): a project with
 * a file of a language whose grammar is not cached is indexed as text at
 * once, the grammar is fetched in the background, and the next indexing pass
 * parses the file. The grammar served is the real R release asset committed
 * under tests/fixtures/grammars/.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexProject, waitForRequestedGrammars } from '../../src/indexing/index-coordinator';
import { WorkerPool } from '../../src/indexing/worker-pool';
import { SqliteStore } from '../../src/stores/sqlite';
import { defaultConfig } from '../../src/config/defaults';
import { configureGrammarStore, grammarStore, loadGrammarManifest, type GrammarFetch } from '../../src/parsers/grammar-store';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R_GRAMMAR = readFileSync(join(REPO, 'tests', 'fixtures', 'grammars', 'tree-sitter-r.wasm'));
const R_SOURCE = join(REPO, 'tests', 'fixtures', 'on-demand', 'r', 'stats.R');
const R_URL = loadGrammarManifest().grammars.r.url;

describe('indexing a project with an on-demand language', () => {
  let root: string;
  let dataDir: string;
  let cacheRoot: string;
  let store: SqliteStore;
  let file: string;
  let previousCacheDir: string | undefined;

  const serving = (body: Buffer): GrammarFetch & ReturnType<typeof vi.fn> => vi.fn(async () => new Response(body));
  const config = (extra: Partial<typeof defaultConfig> = {}): typeof defaultConfig => ({ ...defaultConfig, projectRoot: root, ...extra });
  const symbolNames = (): string[] => store.getSymbolsByFile(file).map((s) => s.name).sort();

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-on-demand-src-')));
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-on-demand-data-'));
    cacheRoot = mkdtempSync(join(tmpdir(), 'hesman-on-demand-cache-'));
    // Worker threads build their own store from the environment.
    previousCacheDir = process.env.HESMAN_CACHE_DIR;
    process.env.HESMAN_CACHE_DIR = cacheRoot;
    file = join(root, 'stats.R');
    copyFileSync(R_SOURCE, file);
    writeFileSync(join(root, 'app.ts'), 'export function main(): number {\n  return 1;\n}\n');
    writeFileSync(join(root, 'README.md'), '# Demo\n\nSome prose.\n');
    store = new SqliteStore(dataDir);
    store.open();
  });

  afterEach(() => {
    store.close();
    configureGrammarStore({ cacheRoot: undefined, fetch: undefined, offline: undefined });
    if (previousCacheDir === undefined) delete process.env.HESMAN_CACHE_DIR;
    else process.env.HESMAN_CACHE_DIR = previousCacheDir;
    for (const dir of [root, dataDir, cacheRoot]) rmSync(dir, { recursive: true, force: true });
  });

  it('indexes the file as text at once, fetches the grammar in the background, and parses it on the next pass', async () => {
    const fetch = serving(R_GRAMMAR);
    configureGrammarStore({ cacheRoot, fetch, offline: false });

    const first = await indexProject(root, store, config());
    expect(first.errors).toEqual([]);
    expect(first.grammarsRequested).toEqual(['r']);
    expect(store.getTextFile(file)).toMatchObject({ language: 'r' });
    expect(symbolNames()).toEqual([]);
    // The bundled language in the same project is parsed as usual.
    expect(store.getSymbolsByFile(join(root, 'app.ts')).map((s) => s.name)).toEqual(['main']);

    expect(await waitForRequestedGrammars(first.grammarsRequested)).toEqual(['r']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(R_URL);

    const second = await indexProject(root, store, config());
    expect(second.errors).toEqual([]);
    expect(second.grammarsRequested).toEqual([]);
    expect(second.filesIndexed).toBe(1);
    expect(symbolNames()).toEqual(['report', 'safe_mean', 'spread']);
    expect(store.getSymbolsByFile(file)[0].language).toBe('r');
    expect(store.getTextFile(file)).toBeUndefined();

    const third = await indexProject(root, store, config());
    expect(third.filesIndexed).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never asks for a grammar that has no tags query: such files simply stay text', async () => {
    const fetch = serving(R_GRAMMAR);
    configureGrammarStore({ cacheRoot, fetch, offline: false });
    rmSync(file);

    const result = await indexProject(root, store, config());
    expect(result.grammarsRequested).toEqual([]);
    expect(store.getTextFile(join(root, 'README.md'))).toMatchObject({ language: 'markdown' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads nothing when the config key turns downloads off', async () => {
    const fetch = serving(R_GRAMMAR);
    configureGrammarStore({ cacheRoot, fetch, offline: false });

    const result = await indexProject(root, store, config({ grammars: { offline: true } }));
    expect(result.errors).toEqual([]);
    expect(result.grammarsRequested).toEqual([]);
    expect(store.getTextFile(file)).toMatchObject({ language: 'r' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads nothing in offline mode (HESMAN_GRAMMARS_OFFLINE)', async () => {
    const fetch = serving(R_GRAMMAR);
    configureGrammarStore({ cacheRoot, fetch, offline: undefined });
    expect(process.env.HESMAN_GRAMMARS_OFFLINE).toBe('1');

    const result = await indexProject(root, store, config());
    expect(result.grammarsRequested).toEqual([]);
    expect(store.getTextFile(file)).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(grammarStore().status('r')).toEqual({ state: 'missing', reason: 'offline' });
  });

  it('keeps the file on the text tier when the download does not match its pin', async () => {
    configureGrammarStore({ cacheRoot, fetch: serving(Buffer.from('tampered')), offline: false });

    const first = await indexProject(root, store, config());
    expect(first.errors).toEqual([]);
    expect(first.grammarsRequested).toEqual(['r']);
    expect(await waitForRequestedGrammars(first.grammarsRequested)).toEqual([]);
    expect(grammarStore().status('r')).toMatchObject({ state: 'missing', reason: 'download-failed' });

    const second = await indexProject(root, store, config());
    expect(second.errors).toEqual([]);
    expect(second.filesIndexed).toBe(0);
    expect(store.getTextFile(file)).toBeDefined();
  });

  it('stops waiting for downloads when the run is aborted', async () => {
    const fetch: GrammarFetch = () => new Promise<Response>(() => {});
    configureGrammarStore({ cacheRoot, fetch, offline: false });
    const first = await indexProject(root, store, config());
    const abort = new AbortController();
    const waiting = waitForRequestedGrammars(first.grammarsRequested, abort.signal);
    abort.abort();
    expect(await waiting).toEqual([]);
  });

  it('loads the cached grammar in the worker threads too', async () => {
    configureGrammarStore({ cacheRoot, fetch: serving(R_GRAMMAR), offline: false });
    await grammarStore().install('r');
    const pool = new WorkerPool(1);
    try {
      const result = await indexProject(root, store, config(), undefined, pool);
      expect(result.errors).toEqual([]);
      expect(symbolNames()).toEqual(['report', 'safe_mean', 'spread']);
    } finally {
      await pool.terminate(true);
    }
  });

  describe('against a local HTTP server', () => {
    let server: Server;
    let base: string;
    let requests: string[];

    beforeEach(async () => {
      requests = [];
      server = createServer((req, res) => {
        requests.push(req.url ?? '');
        res.writeHead(200, { 'content-type': 'application/wasm', 'content-length': R_GRAMMAR.length });
        res.end(R_GRAMMAR);
      });
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
      await new Promise<void>((done) => server.close(() => done()));
    });

    it('has the grammar verified and cached well within a second of the first request', async () => {
      // The manifest URL is the only thing asked for; this fetch maps its path onto the local server.
      const fetch: GrammarFetch = (url, init) => globalThis.fetch(base + new URL(url).pathname, { signal: init.signal });
      configureGrammarStore({ cacheRoot, fetch, offline: false });

      const started = performance.now();
      const first = await indexProject(root, store, config());
      const indexed = performance.now();
      const arrived = await waitForRequestedGrammars(first.grammarsRequested);
      const cached = performance.now();

      expect(arrived).toEqual(['r']);
      expect(requests).toEqual([new URL(R_URL).pathname]);
      expect(cached - started).toBeLessThan(1000);
      if (process.env.HESMAN_PRINT_TIMINGS) {
        console.log(
          `first pass (text tier) ${(indexed - started).toFixed(1)} ms; grammar cached ${(cached - started).toFixed(1)} ms after the pass started ` +
            `(${R_GRAMMAR.length} bytes)`,
        );
      }
      await indexProject(root, store, config());
      expect(symbolNames()).toEqual(['report', 'safe_mean', 'spread']);
    });
  });
});
