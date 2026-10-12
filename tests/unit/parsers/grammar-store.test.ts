import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GrammarStore,
  grammarsOfflineFromEnv,
  resolveCacheRoot,
  type GrammarFetch,
  type GrammarManifest,
} from '../../../src/parsers/grammar-store';

const BYTES = Buffer.from('not really wasm, but pinned by hash');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const URL_ZIG = 'https://github.com/example/tree-sitter-zig/releases/download/v1.0.0/tree-sitter-zig.wasm';

function manifest(): GrammarManifest {
  return {
    abi: { min: 13, max: 15 },
    grammars: {
      lua: {
        bundled: true,
        file: 'tree-sitter-lua.wasm',
        url: 'https://github.com/example/tree-sitter-lua/releases/download/v1/tree-sitter-lua.wasm',
        sha256: 'a'.repeat(64),
        bytes: 10,
        abi: 15,
        source: { repo: 'https://github.com/example/tree-sitter-lua', rev: 'v1', license: 'MIT' },
      },
      zig: {
        bundled: false,
        file: 'tree-sitter-zig.wasm',
        url: URL_ZIG,
        sha256: SHA,
        bytes: BYTES.length,
        abi: 14,
        source: { repo: 'https://github.com/example/tree-sitter-zig', rev: 'v1.0.0', license: 'MIT' },
      },
    },
  };
}

const serving = (body: Buffer, status = 200): GrammarFetch & ReturnType<typeof vi.fn> =>
  vi.fn(async () => new Response(body, { status }));

describe('resolveCacheRoot', () => {
  it('prefers HESMAN_CACHE_DIR, then XDG_CACHE_HOME, then the platform default', () => {
    expect(resolveCacheRoot({ HESMAN_CACHE_DIR: '/c/hesman', XDG_CACHE_HOME: '/xdg' }, 'linux', '/home/u')).toBe('/c/hesman');
    expect(resolveCacheRoot({ XDG_CACHE_HOME: '/xdg' }, 'darwin', '/Users/u')).toBe('/xdg');
    expect(resolveCacheRoot({}, 'darwin', '/Users/u')).toBe(join('/Users/u', 'Library', 'Caches'));
    expect(resolveCacheRoot({}, 'linux', '/home/u')).toBe(join('/home/u', '.cache'));
    expect(resolveCacheRoot({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Local',
    );
    expect(resolveCacheRoot({}, 'win32', '/home/u')).toBe(join('/home/u', 'AppData', 'Local'));
  });

  it('ignores a relative XDG_CACHE_HOME, as the XDG specification requires', () => {
    expect(resolveCacheRoot({ XDG_CACHE_HOME: 'relative/cache' }, 'linux', '/home/u')).toBe(join('/home/u', '.cache'));
  });
});

describe('grammarsOfflineFromEnv', () => {
  it('is on for 1 and true only', () => {
    expect(grammarsOfflineFromEnv({ HESMAN_GRAMMARS_OFFLINE: '1' })).toBe(true);
    expect(grammarsOfflineFromEnv({ HESMAN_GRAMMARS_OFFLINE: 'true' })).toBe(true);
    expect(grammarsOfflineFromEnv({ HESMAN_GRAMMARS_OFFLINE: '0' })).toBe(false);
    expect(grammarsOfflineFromEnv({})).toBe(false);
  });
});

describe('GrammarStore', () => {
  let root: string;
  let parsersDir: string;

  const storeWith = (fetch: GrammarFetch, extra: { offline?: boolean; timeoutMs?: number } = {}): GrammarStore =>
    new GrammarStore({ manifest: manifest(), cacheRoot: root, parsersDir, fetch, offline: false, ...extra });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hesman grammar cache '));
    parsersDir = mkdtempSync(join(tmpdir(), 'hesman-parsers-'));
    writeFileSync(join(parsersDir, 'tree-sitter-lua.wasm'), 'bundled');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(parsersDir, { recursive: true, force: true });
  });

  it('keeps grammars under hesman/grammars/abi-<max>/<lang>-<sha12>.wasm', () => {
    const store = storeWith(serving(BYTES));
    expect(store.cacheDir).toBe(join(root, 'hesman', 'grammars', 'abi-15'));
    expect(store.cachePath('zig')).toBe(join(store.cacheDir, `zig-${SHA.slice(0, 12)}.wasm`));
  });

  it('reports a bundled grammar as bundled and never downloads it', async () => {
    const fetch = serving(BYTES);
    const store = storeWith(fetch);
    expect(store.status('lua')).toEqual({ state: 'bundled' });
    expect(store.availablePath('lua')).toBe(join(parsersDir, 'tree-sitter-lua.wasm'));
    expect(await store.install('lua')).toBe('present');
    expect(store.request(['lua'])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a language outside the catalog as missing: not-in-catalog', async () => {
    const store = storeWith(serving(BYTES));
    expect(store.status('cobol')).toEqual({ state: 'missing', reason: 'not-in-catalog' });
    expect(store.availablePath('cobol')).toBeNull();
    expect(store.request(['cobol'])).toEqual([]);
    await expect(store.install('cobol')).rejects.toThrow(/not in the grammar catalog/);
  });

  it('downloads, verifies and caches a grammar, asking only for the manifest URL', async () => {
    const fetch = serving(BYTES);
    const store = storeWith(fetch);
    expect(store.status('zig')).toEqual({ state: 'missing', reason: 'not-downloaded' });
    expect(store.availablePath('zig')).toBeNull();

    expect(await store.install('zig')).toBe('downloaded');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(URL_ZIG);
    expect(readFileSync(store.cachePath('zig'))).toEqual(BYTES);
    expect(store.availablePath('zig')).toBe(store.cachePath('zig'));
    expect(store.status('zig')).toEqual({ state: 'cached' });
    // Nothing but the grammar (and the notice) is left behind: no temporary file.
    expect(readdirSync(store.cacheDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(await store.install('zig')).toBe('present');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a tampered download and writes nothing', async () => {
    const store = storeWith(serving(Buffer.from('not really wasm, but pinned by HASH')));
    await expect(store.install('zig')).rejects.toThrow(/Checksum mismatch for zig/);
    expect(existsSync(store.cachePath('zig'))).toBe(false);
    expect(existsSync(store.cacheDir) ? readdirSync(store.cacheDir) : []).toEqual([]);
    expect(store.status('zig')).toMatchObject({ state: 'missing', reason: 'download-failed' });
  });

  it('rejects a body larger than the pinned size without hashing it', async () => {
    const store = storeWith(serving(Buffer.concat([BYTES, BYTES])));
    await expect(store.install('zig')).rejects.toThrow(/larger than the pinned/);
    expect(existsSync(store.cachePath('zig'))).toBe(false);
  });

  it('reports an HTTP error as a failed download', async () => {
    const store = storeWith(serving(Buffer.from('nope'), 503));
    await expect(store.install('zig')).rejects.toThrow(/HTTP 503/);
    expect(store.status('zig')).toEqual({ state: 'missing', reason: 'download-failed', detail: expect.stringContaining('HTTP 503') });
  });

  it('deletes a cached file that no longer matches its hash and treats it as missing', async () => {
    const store = storeWith(serving(BYTES));
    await store.install('zig');
    writeFileSync(store.cachePath('zig'), 'corrupted on disk, different size');

    expect(store.availablePath('zig')).toBeNull();
    expect(existsSync(store.cachePath('zig'))).toBe(false);
    expect(store.status('zig').state).toBe('missing');
  });

  it('re-hashes before a load: verifiedPath rejects and deletes a file changed after it was checked', async () => {
    const store = storeWith(serving(BYTES));
    await store.install('zig');
    expect(store.verifiedPath('zig')).toBe(store.cachePath('zig'));

    // Same size, so only a hash can tell.
    writeFileSync(store.cachePath('zig'), Buffer.from(BYTES.toString().toUpperCase()));
    expect(() => store.verifiedPath('zig')).toThrow(/not available/);
    expect(existsSync(store.cachePath('zig'))).toBe(false);
  });

  it('accepts a file another process cached', () => {
    const store = storeWith(serving(BYTES));
    mkdirSync(store.cacheDir, { recursive: true });
    writeFileSync(store.cachePath('zig'), BYTES);
    expect(store.availablePath('zig')).toBe(store.cachePath('zig'));
    expect(store.status('zig')).toEqual({ state: 'cached' });
  });

  it('downloads nothing when offline', async () => {
    const fetch = serving(BYTES);
    const store = storeWith(fetch, { offline: true });
    expect(store.request(['zig'])).toEqual([]);
    await expect(store.install('zig')).rejects.toThrow(/offline/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.status('zig')).toEqual({ state: 'missing', reason: 'offline' });
  });

  it('still uses a grammar that is already cached when offline', async () => {
    await storeWith(serving(BYTES)).install('zig');
    const offline = storeWith(serving(BYTES), { offline: true });
    expect(offline.availablePath('zig')).toBe(offline.cachePath('zig'));
  });

  it('fetches in the background: request() returns at once and settled() waits', async () => {
    let release: (response: Response) => void = () => {};
    const fetch = vi.fn<GrammarFetch>(() => new Promise<Response>((resolve) => { release = resolve; }));
    const store = storeWith(fetch);

    expect(store.request(['zig', 'lua', 'cobol'])).toEqual(['zig']);
    expect(store.status('zig')).toEqual({ state: 'missing', reason: 'downloading' });
    // A second request joins the download in flight.
    expect(store.request(['zig'])).toEqual(['zig']);
    expect(fetch).toHaveBeenCalledTimes(1);

    release(new Response(BYTES));
    await store.settled();
    expect(store.status('zig')).toEqual({ state: 'cached' });
    expect(store.request(['zig'])).toEqual([]);
  });

  it('never rejects from the background and does not retry a failed download right away', async () => {
    const fetch = vi.fn<GrammarFetch>(async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); });
    const store = storeWith(fetch);

    expect(store.request(['zig'])).toEqual(['zig']);
    await store.settled();
    expect(store.status('zig')).toEqual({ state: 'missing', reason: 'download-failed', detail: expect.stringContaining('ENOTFOUND') });
    expect(store.request(['zig'])).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // An explicit install does retry.
    await expect(store.install('zig')).rejects.toThrow(/ENOTFOUND/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up on a download that exceeds the timeout', async () => {
    const fetch: GrammarFetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
      });
    const store = storeWith(fetch, { timeoutMs: 20 });
    await expect(store.install('zig')).rejects.toThrow(/aborted/);
  });

  describe('installFromDirectory', () => {
    let from: string;
    beforeEach(() => {
      from = mkdtempSync(join(tmpdir(), 'hesman-grammars-from-'));
    });
    afterEach(() => rmSync(from, { recursive: true, force: true }));

    it('installs files named like the upstream asset after the same sha256 check, without the network', () => {
      const fetch = serving(BYTES);
      const store = storeWith(fetch, { offline: true });
      writeFileSync(join(from, 'tree-sitter-zig.wasm'), BYTES);

      expect(store.installFromDirectory(from)).toEqual([{ id: 'zig', result: 'installed' }]);
      expect(readFileSync(store.cachePath('zig'))).toEqual(BYTES);
      expect(store.status('zig')).toEqual({ state: 'cached' });
      expect(fetch).not.toHaveBeenCalled();
      expect(store.installFromDirectory(from)).toEqual([{ id: 'zig', result: 'present' }]);
    });

    it('also accepts the cache file name, so one cache directory can seed another', () => {
      const store = storeWith(serving(BYTES));
      writeFileSync(join(from, `zig-${SHA.slice(0, 12)}.wasm`), BYTES);
      expect(store.installFromDirectory(from, ['zig'])).toEqual([{ id: 'zig', result: 'installed' }]);
    });

    it('refuses a file with the wrong hash and reports a grammar that is not there', () => {
      const store = storeWith(serving(BYTES));
      expect(store.installFromDirectory(from, ['zig'])).toEqual([{ id: 'zig', result: 'not-found' }]);
      writeFileSync(join(from, 'tree-sitter-zig.wasm'), 'tampered');
      expect(store.installFromDirectory(from, ['zig'])).toEqual([{ id: 'zig', result: 'checksum-mismatch' }]);
      expect(existsSync(store.cachePath('zig'))).toBe(false);
    });
  });

  it('writes a notice naming the source and license of each cached grammar', async () => {
    const store = storeWith(serving(BYTES));
    await store.install('zig');
    const notice = readFileSync(join(store.cacheDir, 'NOTICE.txt'), 'utf-8');
    expect(notice).toContain('https://github.com/example/tree-sitter-zig');
    expect(notice).toContain('v1.0.0');
    expect(notice).toContain('MIT');
  });
});
