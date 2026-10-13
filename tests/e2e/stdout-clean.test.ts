import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type HesmanTestServer } from './helpers/server.js';

/**
 * In MCP stdio mode stdout is the JSON-RPC channel: any log line written
 * there corrupts the protocol stream. Logs must go to stderr instead.
 */
describe('E2E — stdout carries only JSON-RPC at the default log level', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    // Default level (`info`), so the normal startup/indexing logs are emitted.
    server = await startServer({ fixture: 'polyglot-basic' });
    // Exercise a tool so request-time logging is covered too.
    await server.callTool('index_status', {});
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it('writes no non-protocol lines to stdout', () => {
    expect(server.nonProtocolStdoutLines).toEqual([]);
  });

  it('every stdout line is a JSON-RPC 2.0 message', () => {
    expect(server.stdoutLines.length).toBeGreaterThan(0);
    for (const line of server.stdoutLines) {
      if (line.trim().length === 0) continue;
      const parsed = JSON.parse(line) as { jsonrpc?: string };
      expect(parsed.jsonrpc).toBe('2.0');
    }
  });

  it('writes log output to stderr', () => {
    expect(server.stderrLines.length).toBeGreaterThan(0);
    expect(server.stderrLines.join('\n')).toMatch(/index/i);
  });
});
