import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGrammars } from '../../../src/cli/grammars';
import { GrammarStore, loadGrammarManifest, type GrammarFetch, type GrammarManifest } from '../../../src/parsers/grammar-store';

const ZIG = Buffer.from('zig grammar bytes');
const R = Buffer.from('the r grammar, a little longer');
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const url = (name: string): string => `https://github.com/example/tree-sitter-${name}/releases/download/v1/tree-sitter-${name}.wasm`;

function manifest(): GrammarManifest {
  const entry = (name: string, bytes: Buffer, extra: object = {}) => ({
    bundled: false,
    file: `tree-sitter-${name}.wasm`,
    url: url(name),
    sha256: hash(bytes),
    bytes: bytes.length,
    abi: 14,
    source: { repo: `https://github.com/example/tree-sitter-${name}`, rev: 'v1', commit: 'c'.repeat(40), license: 'MIT' },
    ...extra,
  });
  return {
    abi: { min: 13, max: 15 },
    grammars: {
      lua: { ...entry('lua', Buffer.alloc(54_603)), bundled: true, abi: 15, extensions: ['.lua'], queries: { tags: ['queries/lua/tags.scm'] } },
      r: entry('r', R, { extensions: ['.r'], queries: { tags: ['queries/r/tags.scm'] } }),
      zig: entry('zig', ZIG),
    },
  };
}

describe('hesman grammars', () => {
  let cacheRoot: string;
  let from: string;
  let lines: string[];
  let fetch: GrammarFetch & ReturnType<typeof vi.fn>;

  const store = (extra: { offline?: boolean } = {}): GrammarStore =>
    new GrammarStore({ manifest: manifest(), cacheRoot, parsersDir: cacheRoot, fetch, offline: false, ...extra });
  const run = (args: string[], grammars: GrammarStore = store()): Promise<number> =>
    runGrammars(args, { out: (line) => lines.push(line) }, grammars);
  const output = (): string => lines.join('\n');

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'hesman-grammars-cli-'));
    from = mkdtempSync(join(tmpdir(), 'hesman-grammars-cli-from-'));
    lines = [];
    fetch = vi.fn(async (requested: string) => new Response(requested === url('r') ? R : ZIG));
  });

  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
    rmSync(from, { recursive: true, force: true });
  });

  describe('list', () => {
    it('shows bundled, cached and available grammars with their sizes, and the size of everything on demand', async () => {
      const grammars = store();
      await grammars.install('r');
      expect(await run(['list'], grammars)).toBe(0);
      const text = output();
      expect(text).toMatch(/lua\s+bundled\s+54\.6 kB/);
      expect(text).toMatch(/r\s+cached\s+30 B/);
      expect(text).toMatch(/zig\s+available\s+17 B/);
      expect(text).toContain('1 bundled (54.6 kB)');
      expect(text).toContain('1 cached (30 B)');
      expect(text).toContain('2 on demand (47 B to download all)');
      expect(text).toContain(grammars.cacheDir);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('says which on-demand grammars give symbols and which leave their files on the text tier', async () => {
      await run(['list']);
      expect(output()).toMatch(/r\s+available\s+30 B\s+14\s+symbols/);
      expect(output()).toMatch(/zig\s+available\s+17 B\s+14\s+text tier/);
    });

    it('prints machine-readable JSON with --json', async () => {
      const grammars = store({ offline: true });
      expect(await run(['list', '--json'], grammars)).toBe(0);
      const parsed = JSON.parse(output());
      expect(parsed).toMatchObject({
        abi: { min: 13, max: 15 },
        cacheDir: grammars.cacheDir,
        offline: true,
        totals: { bundled: 1, bundledBytes: 54_603, cached: 0, cachedBytes: 0, onDemand: 2, onDemandBytes: 47 },
      });
      expect(parsed.grammars).toEqual([
        expect.objectContaining({ id: 'lua', state: 'bundled', bytes: 54_603, abi: 15, symbols: true, license: 'MIT', rev: 'v1' }),
        expect.objectContaining({ id: 'r', state: 'available', bytes: 30, symbols: true, extensions: ['.r'], url: url('r') }),
        expect.objectContaining({ id: 'zig', state: 'available', bytes: 17, symbols: false }),
      ]);
    });

    it('is the default subcommand', async () => {
      expect(await run([])).toBe(0);
      expect(output()).toMatch(/zig\s+available/);
    });
  });

  describe('install', () => {
    it('downloads the named grammars, verified, and reports each', async () => {
      const grammars = store();
      expect(await run(['install', 'r', 'lua'], grammars)).toBe(0);
      expect(output()).toMatch(/r: downloaded \(30 B\)/);
      expect(output()).toMatch(/lua: bundled/);
      expect(readFileSync(grammars.cachePath('r'))).toEqual(R);
      expect(fetch).toHaveBeenCalledTimes(1);

      lines = [];
      expect(await run(['install', 'r'], grammars)).toBe(0);
      expect(output()).toMatch(/r: already cached/);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown language before downloading anything', async () => {
      expect(await run(['install', 'r', 'cobol'])).toBe(1);
      expect(output()).toMatch(/cobol.*not in the grammar catalog/);
      expect(output()).toContain('hesman grammars list');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('needs a language, --all or --from', async () => {
      expect(await run(['install'])).toBe(1);
      expect(output()).toMatch(/hesman grammars install <language…>/);
    });

    it('fails, and caches nothing, when a download does not match its pin', async () => {
      fetch = vi.fn(async () => new Response(Buffer.from('tampered')));
      const grammars = store();
      expect(await run(['install', 'zig'], grammars)).toBe(1);
      expect(output()).toMatch(/zig: failed — .*Checksum mismatch/);
      expect(existsSync(grammars.cachePath('zig'))).toBe(false);
    });

    it('--all prints the total download size first, then installs every on-demand grammar', async () => {
      const grammars = store();
      expect(await run(['install', '--all'], grammars)).toBe(0);
      expect(lines[0]).toBe('Installing 2 grammars (47 B to download) into ' + grammars.cacheDir);
      expect(output()).toMatch(/r: downloaded/);
      expect(output()).toMatch(/zig: downloaded/);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(lines.at(-1)).toBe('2 installed, 0 already present, 0 failed.');
    });

    it('--all only counts what is still missing', async () => {
      const grammars = store();
      await grammars.install('r');
      await run(['install', '--all'], grammars);
      expect(lines[0]).toContain('Installing 1 grammar (17 B to download)');
    });

    it('downloads nothing in offline mode and points at --from', async () => {
      expect(await run(['install', 'r'], store({ offline: true }))).toBe(1);
      expect(output()).toMatch(/r: failed — .*offline/i);
      expect(output()).toContain('--from');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('--from installs from a directory with the same sha256 check and no network, even offline', async () => {
      writeFileSync(join(from, 'tree-sitter-r.wasm'), R);
      writeFileSync(join(from, 'tree-sitter-zig.wasm'), 'tampered');
      const grammars = store({ offline: true });

      expect(await run(['install', '--from', from], grammars)).toBe(1);
      expect(output()).toMatch(/r: installed from /);
      expect(output()).toMatch(/zig: failed — .*sha256/);
      expect(readFileSync(grammars.cachePath('r'))).toEqual(R);
      expect(existsSync(grammars.cachePath('zig'))).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('--from with languages reports the ones that are not in the directory', async () => {
      writeFileSync(join(from, 'tree-sitter-r.wasm'), R);
      expect(await run(['install', '--from', from, 'r', 'zig'])).toBe(1);
      expect(output()).toMatch(/r: installed from /);
      expect(output()).toMatch(/zig: failed — tree-sitter-zig\.wasm not found in /);
    });

    it('--from needs an existing directory', async () => {
      expect(await run(['install', '--from', join(from, 'missing')])).toBe(1);
      expect(output()).toMatch(/not a directory/);
    });
  });

  it('prints usage for --help and for an unknown subcommand', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(output()).toContain('hesman grammars install --from <directory>');
    lines = [];
    expect(await run(['frobnicate'])).toBe(1);
    expect(output()).toContain('Unknown subcommand');
  });

  it('states the real total of the shipped catalog in its help text', async () => {
    await run(['--help']);
    const total = Object.values(loadGrammarManifest().grammars)
      .filter((entry) => !entry.bundled)
      .reduce((sum, entry) => sum + entry.bytes, 0);
    expect(output()).toContain(`${(total / 1_000_000).toFixed(1)} MB`);
  });
});
