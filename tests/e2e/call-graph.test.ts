import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type HesmanTestServer } from './helpers/server.js';

interface SymbolHit {
  id: string;
  name: string;
  filePath: string;
}

interface ChainEntry {
  symbolId: string;
  name: string;
  filePath: string;
  depth: number;
  callSite: { filePath: string; line: number };
}

/** Polls `find_symbol` (exact) until the symbol shows up or the timeout elapses. */
async function findSymbolEventually(server: HesmanTestServer, name: string, timeoutMs = 30000): Promise<SymbolHit> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = await server.callToolJson<{ symbols?: SymbolHit[] }>('find_symbol', { name, matchMode: 'exact' });
    const hit = (data.symbols ?? []).find((s) => s.name === name);
    if (hit) return hit;
    if (Date.now() >= deadline) throw new Error(`symbol ${name} was never indexed`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Polls `get_callers` until `expected` shows up (indexing may still be running). */
async function callersEventually(
  server: HesmanTestServer,
  symbolName: string,
  expected: string,
  timeoutMs = 30000,
): Promise<ChainEntry[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const sym = await findSymbolEventually(server, symbolName);
    const data = await server.callToolJson<{ callers?: ChainEntry[] }>('get_callers', { symbolId: sym.id });
    const callers = data.callers ?? [];
    if (callers.some((c) => c.name === expected) || Date.now() >= deadline) return callers;
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('E2E — call graph on polyglot-basic', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    server = await startServer({ fixture: 'polyglot-basic' });
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it.each([
    ['GoGreet', 'main', 'go/main.go', 6],
    ['tsGreet', 'tsMain', 'ts/main.ts', 4],
    ['py_greet', 'py_main', 'py/main.py', 5],
  ])('get_callers(%s) returns the cross-file caller %s and no self-call', async (callee, caller, callerFile, line) => {
    const callers = await callersEventually(server, callee, caller);
    const names = callers.map((c) => c.name);
    expect(names).toContain(caller);
    expect(names).not.toContain(callee);
    const hit = callers.find((c) => c.name === caller);
    expect(hit?.filePath.endsWith(callerFile)).toBe(true);
    expect(hit?.callSite.line).toBe(line);
  }, 60000);

  it.each([
    ['GoGreet', 'GoFormatName'],
    ['tsGreet', 'tsFormatName'],
    ['py_greet', 'py_format_name'],
  ])('get_callees(%s) returns %s and no self-call', async (caller, callee) => {
    const sym = await findSymbolEventually(server, caller);
    const data = await server.callToolJson<{ callees?: ChainEntry[] }>('get_callees', { symbolId: sym.id });
    const names = (data.callees ?? []).map((c) => c.name);
    expect(names).toContain(callee);
    expect(names).not.toContain(caller);
  });

  it('impact_analysis(GoGreet) lists the caller in go/main.go', async () => {
    await callersEventually(server, 'GoGreet', 'main');
    const sym = await findSymbolEventually(server, 'GoGreet');
    const text = JSON.stringify(
      await server.callToolJson('impact_analysis', { symbolId: sym.id, changeType: 'rename', newName: 'GoHello' }),
    );
    expect(text).toContain('main.go');
  }, 60000);
});
