/**
 * E2E — text tier (M1-04) through the real server binary: files without a
 * grammar are found by `semantic_search` and `find_pattern`, `get_context`
 * returns their lines, and a binary file is skipped.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { startServer, type HesmanTestServer } from './helpers/server.js';

interface SearchRow {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  language?: string;
  precision?: string;
}

describe('E2E — text tier', () => {
  let server: HesmanTestServer;
  const path = (rel: string): string => join(server.projectRoot, rel);

  beforeAll(async () => {
    server = await startServer({ fixture: 'text-tier', semantic: true, readyTimeoutMs: 110000 });
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it('index_status counts text files apart from parsed files', async () => {
    const status = await server.callToolJson<{
      totalFiles: number;
      indexing: { filesTotal: number; filesDone: number };
      textTier: { files: number; chunks: number; languages: Array<{ language: string; files: number }> };
    }>('index_status');
    expect(status.totalFiles).toBe(1);
    expect(status.indexing).toMatchObject({ filesTotal: 8, filesDone: 8 });
    expect(status.textTier.files).toBe(7);
    expect(status.textTier.languages.map((l) => l.language).sort()).toEqual(
      ['cobol', 'dockerfile', 'makefile', 'shell', 'sql', 'text', 'zig'],
    );
  });

  it('semantic_search finds a file without a grammar and marks it precision "text"', async () => {
    const data = await server.callToolJson<{ results: SearchRow[] }>('semantic_search', {
      query: 'customers table with email and loyalty points',
      topK: 5,
    });
    const hit = data.results.find((r) => r.filePath === path('db/schema.sql'));
    expect(hit).toMatchObject({ kind: 'text', precision: 'text', language: 'sql', name: 'schema.sql', startLine: 1 });
    expect(hit!.snippet).toContain('loyalty_points INTEGER');
    for (const row of data.results) {
      expect(row.precision === 'text').toBe(row.kind === 'text');
    }
  }, 60000);

  it('find_pattern searches a language without a grammar by its label', async () => {
    const data = await server.callToolJson<{
      matches: Array<{ filePath: string; line: number; bindings: Record<string, string> }>;
      precision?: string;
    }>('find_pattern', { pattern: 'CREATE TABLE $NAME (', language: 'sql' });
    expect(data.matches.map((m) => [m.filePath, m.line, m.bindings.NAME])).toEqual([
      [path('db/schema.sql'), 2, 'customers'],
      [path('db/schema.sql'), 9, 'orders'],
    ]);
    expect(data.precision).toBe('text');
  }, 30000);

  it('get_context returns the lines of a file without a grammar', async () => {
    const data = await server.callToolJson<Record<string, unknown>>('get_context', {
      filePath: 'scripts/deploy.zsh',
      startLine: 5,
      endLine: 7,
      contextLines: 0,
      mode: 'full',
    });
    expect(data).toMatchObject({
      startLine: 5,
      endLine: 7,
      language: 'shell',
      precision: 'text',
      symbolsInRange: [],
    });
    expect(data.content).toBe(
      'upload_release() {\n  aws s3 cp "build/release.tar.gz" "s3://staging-releases/$1.tar.gz"\n}',
    );
  });

  it('skips the binary file, the lockfile and the minified files', async () => {
    const search = await server.callToolJson<{ results: SearchRow[] }>('semantic_search', {
      query: 'upload_release',
      topK: 50,
    });
    const indexed = new Set(search.results.map((r) => r.filePath));
    for (const rel of ['assets/firmware.blob', 'package-lock.json', 'vendor/theme.min.css', 'vendor/bundle.txt']) {
      expect(indexed.has(path(rel)), rel).toBe(false);
    }
    // `find_pattern` scans with the same rules, so the marker inside those files is never matched.
    const pattern = await server.callToolJson<{ matches: Array<{ filePath: string }> }>('find_pattern', {
      pattern: 'upload_release',
      language: 'text',
    });
    expect(pattern.matches).toEqual([]);
  }, 60000);

  it('does not invent symbols for text files', async () => {
    const data = await server.callToolJson<{ symbols: unknown[] }>('find_symbol', { name: 'upload_release', matchMode: 'fuzzy' });
    expect(data.symbols).toEqual([]);
    // Only the TypeScript file contributes symbols.
    const status = await server.callToolJson<{ languages: Array<{ language: string; files: number }> }>('index_status');
    expect(status.languages.map((l) => [l.language, l.files])).toEqual([['typescript', 1]]);
  });

  it('writes nothing but protocol messages to stdout', () => {
    expect(server.nonProtocolStdoutLines).toEqual([]);
  });
});
