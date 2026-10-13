import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type HesmanTestServer } from './helpers/server.js';

interface SymbolHit {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  isExported: boolean;
}

interface IndexStatusResponse {
  totalFiles: number;
  health: Record<string, unknown>;
  languages: Array<{ language: string; files: number; symbols: number }>;
}

interface Meta {
  _meta?: { reduction: string; originalTokens: number; compressedTokens: number; compressed: boolean };
}

/** The six source files of polyglot-basic (two per language) all contain symbols. */
const EXPECTED_FILES = 6;

async function waitForAllFiles(server: HesmanTestServer, timeoutMs = 60000): Promise<IndexStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await server.callToolJson<IndexStatusResponse>('index_status');
    if (status.totalFiles >= EXPECTED_FILES || Date.now() >= deadline) return status;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function findExact(server: HesmanTestServer, name: string): Promise<SymbolHit> {
  const data = await server.callToolJson<{ symbols: SymbolHit[] }>('find_symbol', { name, matchMode: 'exact' });
  const hit = data.symbols.find((s) => s.name === name);
  if (!hit) throw new Error(`symbol ${name} not found`);
  return hit;
}

describe('E2E — accurate metadata (M0-15)', () => {
  let server: HesmanTestServer;
  let status: IndexStatusResponse;

  beforeAll(async () => {
    server = await startServer({ fixture: 'polyglot-basic' });
    status = await waitForAllFiles(server);
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it('reports capitalized Go functions as exported and lowercase ones as not', async () => {
    expect((await findExact(server, 'GoGreet')).isExported).toBe(true);
    expect((await findExact(server, 'GoFormatName')).isExported).toBe(true);
    expect((await findExact(server, 'main')).isExported).toBe(false);
  });

  it('reports public Python functions as exported', async () => {
    expect((await findExact(server, 'py_greet')).isExported).toBe(true);
  });

  it('index_status lists every indexed language with file counts', () => {
    const byLang = Object.fromEntries(status.languages.map((l) => [l.language, l]));
    expect(byLang.typescript?.files).toBe(2);
    expect(byLang.python?.files).toBe(2);
    expect(byLang.go?.files).toBe(2);
    for (const l of status.languages) expect(l.symbols).toBeGreaterThan(0);
  });

  it('index_status no longer reports components Hesman does not have', () => {
    expect(status.health).not.toHaveProperty('kuzuOk');
    expect(status.health.sqliteOk).toBe(true);
  });

  it('_meta.reduction is never negative for any tool on small responses', async () => {
    const greet = await findExact(server, 'GoGreet');
    const format = await findExact(server, 'GoFormatName');
    const calls: Array<[string, Record<string, unknown>]> = [
      ['find_symbol', { name: 'GoGreet', matchMode: 'exact' }],
      ['find_symbol', { name: 'greet', matchMode: 'fuzzy' }],
      ['get_callers', { symbolId: format.id }],
      ['get_callees', { symbolId: greet.id }],
      ['get_references', { symbolId: format.id }],
      ['impact_analysis', { symbolId: format.id, changeType: 'rename', newName: 'X' }],
      ['get_file_structure', { filePath: greet.filePath }],
      ['list_dependencies', { filePath: greet.filePath }],
      ['get_context', { filePath: greet.filePath, startLine: 14 }],
      ['get_context', { filePath: greet.filePath, startLine: 14, mode: 'compact' }],
      ['find_pattern', { pattern: 'GoFormatName($$$ARGS)', language: 'go' }],
    ];
    for (const [tool, args] of calls) {
      const res = await server.callToolJson<Meta>(tool, args);
      expect(res._meta, `${tool} ${JSON.stringify(args)}: _meta`).toBeDefined();
      const pct = parseFloat(res._meta!.reduction);
      expect(pct, `${tool} ${JSON.stringify(args)}: reduction ${res._meta!.reduction}`).toBeGreaterThanOrEqual(0);
      expect(res._meta!.compressedTokens).toBeLessThanOrEqual(res._meta!.originalTokens);
    }
  }, 60000);
});
