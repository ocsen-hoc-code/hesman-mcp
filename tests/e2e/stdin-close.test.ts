import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { startServer, type HesmanTestServer } from './helpers/server.js';

/**
 * When the MCP client dies its end of the stdio pipe closes. The server must
 * notice and shut down instead of lingering as an orphan that keeps the
 * SQLite and ZVec files open.
 */
describe('E2E — server exits when stdin closes', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    server = await startServer({ fixture: 'polyglot-basic' });
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it('exits with code 0 within 5 seconds of stdin closing', async () => {
    // The harness keeps the child private; reach it only to end its stdin
    // without sending a signal, which is what a crashed client looks like.
    const child = (server.transport as unknown as { child: ChildProcess }).child;
    expect(server.transport.pid).toBeGreaterThan(0);
    expect(server.transport.exitCode).toBeNull();

    const exited = new Promise<number | null>((resolveExit) => {
      child.once('exit', (code) => resolveExit(code));
    });
    child.stdin?.end();

    const timeout = new Promise<'timeout'>((resolveTimeout) => {
      setTimeout(() => resolveTimeout('timeout'), 5000).unref();
    });
    const outcome = await Promise.race([exited, timeout]);

    expect(outcome).toBe(0);
    expect(server.stderrLines.join('\n')).toMatch(/stdin closed/i);
  }, 30000);
});
