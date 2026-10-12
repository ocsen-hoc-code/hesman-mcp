/**
 * On-demand grammars through the real binary, without the network: the cache
 * is filled by `hesman grammars install --from` with the R release asset
 * committed under tests/fixtures/grammars/.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type HesmanTestServer } from './helpers/server.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = join(REPO, 'dist', 'index.js');
const GRAMMAR_FIXTURES = join(REPO, 'tests', 'fixtures', 'grammars');

interface GrammarRow {
  language: string;
  tier: string;
  files: number;
  grammar: string;
  reason?: string;
}
interface Status {
  totalSymbols: number;
  textTier: { files: number };
  grammars: { offline: boolean; cacheDir: string; languages: GrammarRow[] };
}
interface Found {
  symbols: Array<{ name: string; kind: string; filePath: string; language?: string }>;
}

describe('E2E — a language whose grammar is delivered on demand', () => {
  let cacheRoot: string;
  let server: HesmanTestServer | undefined;
  const env = (): Record<string, string> => ({ HESMAN_CACHE_DIR: cacheRoot, HESMAN_GRAMMARS_OFFLINE: '1' });
  const cli = (...args: string[]): string =>
    execFileSync(process.execPath, [DIST_ENTRY, ...args], { env: { ...process.env, ...env() }, encoding: 'utf-8' });

  beforeAll(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'hesman-e2e-grammar-cache-'));
  });

  afterAll(async () => {
    await server?.stop();
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('offline with an empty cache: the file is indexed as text and index_status says the grammar is missing', async () => {
    server = await startServer({ fixture: 'on-demand', env: env() });
    try {
      const status = await server.callToolJson<Status>('index_status');
      expect(status.grammars.offline).toBe(true);
      expect(status.grammars.cacheDir).toBe(join(cacheRoot, 'hesman', 'grammars', 'abi-15'));
      expect(status.grammars.languages).toEqual([{ language: 'r', tier: 'text', files: 1, grammar: 'missing', reason: 'offline' }]);
      expect(status.totalSymbols).toBe(0);
      expect(status.textTier.files).toBe(1);
      const found = await server.callToolJson<Found>('find_symbol', { name: 'safe_mean', matchMode: 'exact' });
      expect(found.symbols ?? []).toEqual([]);
      expect(server.nonProtocolStdoutLines).toEqual([]);
    } finally {
      await server.stop();
      server = undefined;
    }
  }, 120000);

  it('hesman grammars install --from fills the cache offline, and list --json shows it', () => {
    const out = cli('grammars', 'install', '--from', GRAMMAR_FIXTURES, 'r');
    expect(out).toMatch(/r: installed from /);
    expect(readdirSync(join(cacheRoot, 'hesman', 'grammars', 'abi-15')).sort()).toEqual([
      'NOTICE.txt',
      expect.stringMatching(/^r-[0-9a-f]{12}\.wasm$/),
    ]);
    const listed = JSON.parse(cli('grammars', 'list', '--json')) as { grammars: Array<{ id: string; state: string }> };
    expect(listed.grammars.find((g) => g.id === 'r')?.state).toBe('cached');
    expect(listed.grammars.find((g) => g.id === 'scala')?.state).toBe('available');
    expect(listed.grammars.filter((g) => g.state === 'bundled')).toHaveLength(16);
  });

  it('with the grammar cached the server parses the file in its worker threads: find_symbol finds an R function', async () => {
    server = await startServer({ fixture: 'on-demand', env: env() });
    const status = await server.callToolJson<Status>('index_status');
    expect(status.grammars.languages).toEqual([{ language: 'r', tier: 'structural', files: 1, grammar: 'cached' }]);
    expect(status.textTier.files).toBe(0);
    const found = await server.callToolJson<Found>('find_symbol', { name: 'safe_mean', matchMode: 'exact' });
    expect(found.symbols).toHaveLength(1);
    expect(found.symbols[0]).toMatchObject({ name: 'safe_mean', kind: 'function' });
    expect(found.symbols[0].filePath).toMatch(/stats\.R$/);
    expect(server.nonProtocolStdoutLines).toEqual([]);
  }, 120000);
});
