import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type HesmanTestServer } from './helpers/server.js';

interface FindSymbolResponse {
  symbols: Array<{ name: string; kind: string; filePath: string }>;
}

/** Polls `find_symbol` (exact) until the symbol shows up or the timeout elapses. */
async function findSymbolEventually(
  server: HesmanTestServer,
  name: string,
  timeoutMs = 30000,
): Promise<FindSymbolResponse['symbols']> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = await server.callToolJson<FindSymbolResponse>('find_symbol', { name, matchMode: 'exact' });
    const matches = (data.symbols ?? []).filter((s) => s.name === name);
    if (matches.length > 0 || Date.now() >= deadline) return matches;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('E2E — every registered language is indexed by the real server', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    server = await startServer({ fixture: 'polyglot-basic' });
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it('find_symbol (exact) finds a TypeScript symbol', async () => {
    const matches = await findSymbolEventually(server, 'tsGreet');
    expect(matches).toHaveLength(1);
    expect(matches[0].filePath).toMatch(/greet\.ts$/);
  }, 60000);

  it('find_symbol (exact) finds a Python symbol', async () => {
    const matches = await findSymbolEventually(server, 'py_greet');
    expect(matches).toHaveLength(1);
    expect(matches[0].filePath).toMatch(/greet\.py$/);
  }, 60000);

  it('find_symbol (exact) finds a Go symbol', async () => {
    const matches = await findSymbolEventually(server, 'GoGreet');
    expect(matches).toHaveLength(1);
    expect(matches[0].filePath).toMatch(/greet\.go$/);
  }, 60000);
});
