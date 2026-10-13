import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type HesmanTestServer } from './helpers/server.js';

/**
 * The default answer of the list tools through the real binary (M4-01): compact
 * rows under named columns, grouped by file, relative paths; `format: "full"`
 * returns the plain objects. Unit tests cover every shape in detail.
 */
interface Compact {
  format: string;
  columns: string[];
  files?: Array<{ file: string; rows: unknown[][] }>;
  rows?: unknown[][];
  _meta: { compressed: boolean; layers: string[]; reduction: string };
}

describe('E2E — list tool response shape (M4-01)', () => {
  let server: HesmanTestServer;

  beforeAll(async () => {
    server = await startServer();
  }, 120000);

  afterAll(async () => {
    await server?.stop();
  });

  it('find_symbol answers in the compact shape with a project-relative file', async () => {
    const data = await server.callToolJson<Compact>('find_symbol', { name: 'GoGreet', matchMode: 'exact' }, 30000);
    // Passing format explicitly bypasses the helper default (plain objects).
    const compact = await server.callToolJson<Compact>('find_symbol', { name: 'GoGreet', matchMode: 'exact', format: 'compact' });
    expect(compact.format).toBe('compact');
    expect(compact.columns).toContain('name');
    const groups = compact.files ?? [];
    expect(groups.map((g) => g.file)).toEqual(expect.arrayContaining([expect.stringMatching(/^go\//)]));
    expect(JSON.stringify(compact)).not.toContain(server.projectRoot);
    expect(compact._meta.layers).toEqual(expect.arrayContaining(['group', 'columns', 'paths']));
    expect(data.format).toBe('full');
  });

  it('format "full" keeps the plain objects with absolute paths', async () => {
    const full = await server.callToolJson<{ format: string; symbols: Array<{ filePath: string }> }>('find_symbol', {
      name: 'GoGreet',
      matchMode: 'exact',
      format: 'full',
    });
    expect(full.format).toBe('full');
    expect(full.symbols[0].filePath.startsWith(server.projectRoot)).toBe(true);
  });

  it('rejects an unknown format with INVALID_INPUT', async () => {
    const result = await server.callTool('get_callers', { symbolId: 'x', format: 'table' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('INVALID_INPUT');
  });
});
