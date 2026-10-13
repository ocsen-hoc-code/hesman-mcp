import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { startServer, toolText, type HesmanTestServer } from './helpers/server.js';

const isWindows = process.platform === 'win32';
// A system file that exists on every CI host and lies outside any fixture.
const SYSTEM_FILE = isWindows ? 'C:\\Windows\\win.ini' : '/etc/hosts';

describe('E2E — get_context is confined to the project root', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    server = await startServer();
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it(`refuses to read ${SYSTEM_FILE}`, async () => {
    const result = await server.callTool('get_context', { filePath: SYSTEM_FILE, startLine: 1 });
    expect(result.isError).toBe(true);
    const body = JSON.parse(toolText(result));
    expect(body.error.code).toBe('PATH_OUTSIDE_PROJECT');
    expect(body.content).toBeUndefined();
  });

  it('refuses a relative path that escapes the root', async () => {
    const result = await server.callTool('get_context', { filePath: '../../../../../../../../etc/hosts', startLine: 1 });
    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result)).error.code).toBe('PATH_OUTSIDE_PROJECT');
  });

  it('still reads a file inside the project by relative path', async () => {
    const result = await server.callTool('get_context', { filePath: join('ts', 'greet.ts'), startLine: 1, mode: 'full' });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(toolText(result)).content).toContain('tsGreet');
  });

  it('get_file_structure accepts a relative path', async () => {
    const result = await server.callTool('get_file_structure', { filePath: join('ts', 'greet.ts') });
    expect(result.isError).toBeFalsy();
    expect(toolText(result)).toContain('tsGreet');
  });
});
