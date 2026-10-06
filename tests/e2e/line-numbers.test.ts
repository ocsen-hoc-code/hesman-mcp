import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type HesmanTestServer } from './helpers/server.js';

interface SymbolHit {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

interface FindSymbolResponse {
  symbols: SymbolHit[];
}

interface FindPatternResponse {
  matches: Array<{ filePath: string; line: number; snippet: string }>;
}

interface GetContextResponse {
  startLine: number;
  endLine: number;
  content: string;
}

/** Polls `find_symbol` (exact) until the symbol shows up or the timeout elapses. */
async function findSymbolEventually(server: HesmanTestServer, name: string, timeoutMs = 30000): Promise<SymbolHit> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = await server.callToolJson<FindSymbolResponse>('find_symbol', { name, matchMode: 'exact' });
    const hit = (data.symbols ?? []).find((s) => s.name === name);
    if (hit) return hit;
    if (Date.now() >= deadline) throw new Error(`symbol ${name} was never indexed`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('E2E — line numbers are 1-based and agree across tools', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    server = await startServer({ fixture: 'polyglot-basic' });
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it('find_symbol reports py_greet on its real file line (5)', async () => {
    const sym = await findSymbolEventually(server, 'py_greet');
    expect(sym.startLine).toBe(5);
    expect(sym.endLine).toBe(6);
  }, 60000);

  it('get_context at a symbol startLine (contextLines 0) returns the declaration line', async () => {
    const sym = await findSymbolEventually(server, 'py_greet');
    const ctx = await server.callToolJson<GetContextResponse>('get_context', {
      filePath: sym.filePath,
      startLine: sym.startLine,
      contextLines: 0,
    });
    expect(ctx.startLine).toBe(sym.startLine);
    expect(ctx.content.split('\n')[0]).toMatch(/^def py_greet\(/);
  }, 60000);

  const cases = [
    { name: 'py_greet', language: 'python', pattern: 'def py_greet($$$ARGS)' },
    { name: 'tsGreet', language: 'typescript', pattern: 'export function tsGreet($$$ARGS)' },
    { name: 'GoGreet', language: 'go', pattern: 'func GoGreet($$$ARGS)' },
  ];

  for (const c of cases) {
    it(`find_pattern and find_symbol agree on the line of ${c.name} (${c.language})`, async () => {
      const sym = await findSymbolEventually(server, c.name);
      const found = await server.callToolJson<FindPatternResponse>('find_pattern', {
        pattern: c.pattern,
        language: c.language,
      });
      const match = found.matches.find((m) => m.filePath === sym.filePath);
      expect(match, `find_pattern found no match for ${c.name}`).toBeDefined();
      expect(sym.startLine).toBe(match!.line);
    }, 60000);
  }
});
