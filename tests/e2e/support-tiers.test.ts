/**
 * Support tiers through the real binary (M1-06): `index_status` names the
 * tier of every indexed language, and a graph tool asked about a symbol of a
 * language without call extraction says so instead of answering with only an
 * empty list.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIST_ENTRY, FIXTURES_DIR, startServer, type HesmanTestServer } from './helpers/server.js';

interface LanguageRow {
  language: string;
  tier: string;
  files: number;
  grammar: string;
  reason?: string;
}
interface Status {
  grammars: { languages: LanguageRow[] };
}
interface Found {
  symbols: Array<{ id: string; name: string }>;
}
interface GraphAnswer {
  note?: string;
  callers?: unknown[];
  callees?: unknown[];
  references?: unknown[];
  impactedFiles?: unknown[];
  _meta?: { compressed: boolean };
}

describe('E2E — support tiers', () => {
  describe('the polyglot fixture (TypeScript, Python, Go and a go.mod)', () => {
    let server: HesmanTestServer;

    beforeAll(async () => {
      server = await startServer();
    }, 120000);

    afterAll(async () => {
      await server?.stop();
    });

    it('index_status has one entry per language with its tier and grammar source', async () => {
      const status = await server.callToolJson<Status>('index_status');
      const rows = [...status.grammars.languages].sort((a, b) => a.language.localeCompare(b.language));
      expect(rows.map(({ language, tier, grammar }) => ({ language, tier, grammar }))).toEqual([
        { language: 'go', tier: 'deep', grammar: 'bundled' },
        // go.mod has no grammar: a text-tier file under its own label.
        { language: 'go-module', tier: 'text', grammar: 'missing' },
        { language: 'python', tier: 'deep', grammar: 'bundled' },
        { language: 'typescript', tier: 'deep', grammar: 'bundled' },
      ]);
      expect(rows.every((row) => row.files > 0)).toBe(true);
    });

    it('get_callers on a deep-language symbol carries no note', async () => {
      const found = await server.callToolJson<Found>('find_symbol', { name: 'py_format_name', matchMode: 'exact' });
      expect(found.symbols.length).toBeGreaterThan(0);
      const answer = await server.callToolJson<GraphAnswer>('get_callers', { symbolId: found.symbols[0].id });
      expect(answer).not.toHaveProperty('note');
      expect(server.nonProtocolStdoutLines).toEqual([]);
    });
  });

  describe('an on-demand language with its grammar cached (R, structural)', () => {
    let cacheRoot: string;
    let server: HesmanTestServer;

    beforeAll(async () => {
      cacheRoot = mkdtempSync(join(tmpdir(), 'hesman-e2e-tier-cache-'));
      const env = { HESMAN_CACHE_DIR: cacheRoot, HESMAN_GRAMMARS_OFFLINE: '1' };
      execFileSync(process.execPath, [DIST_ENTRY, 'grammars', 'install', '--from', join(FIXTURES_DIR, 'grammars'), 'r'], {
        env: { ...process.env, ...env },
        encoding: 'utf-8',
      });
      server = await startServer({ fixture: 'on-demand', env });
    }, 120000);

    afterAll(async () => {
      await server?.stop();
      rmSync(cacheRoot, { recursive: true, force: true });
    });

    const idOf = async (name: string): Promise<string> => {
      const found = await server.callToolJson<Found>('find_symbol', { name, matchMode: 'exact' });
      expect(found.symbols).toHaveLength(1);
      return found.symbols[0].id;
    };

    it('index_status reports the language as structural with a cached grammar', async () => {
      const status = await server.callToolJson<Status>('index_status');
      expect(status.grammars.languages).toEqual([{ language: 'r', tier: 'structural', files: 1, grammar: 'cached' }]);
    });

    it('get_callers returns an explicit note with the empty list', async () => {
      const answer = await server.callToolJson<GraphAnswer>('get_callers', { symbolId: await idOf('safe_mean') });
      expect(answer.callers).toEqual([]);
      expect(answer.note).toBe('call graph not available for r (symbols only)');
      expect(answer._meta).toBeDefined();
    });

    it('get_callees, impact_analysis and get_references carry the note too', async () => {
      const symbolId = await idOf('report');
      expect((await server.callToolJson<GraphAnswer>('get_callees', { symbolId })).note).toBe('call graph not available for r (symbols only)');
      expect((await server.callToolJson<GraphAnswer>('impact_analysis', { symbolId, changeType: 'delete' })).note).toBe(
        'call graph not available for r (symbols only)',
      );
      expect((await server.callToolJson<GraphAnswer>('get_references', { symbolId })).note).toBe('references not available for r (symbols only)');
      expect(server.nonProtocolStdoutLines).toEqual([]);
    });
  });
});
