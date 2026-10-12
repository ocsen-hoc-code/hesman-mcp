import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parseUiArgs, runUiCommand, type UiCommandIo } from '../../../src/ui/server/cli';
import { makeIndexedProject, rawRequest, type TempProject } from './helpers';

function recordingIo(): UiCommandIo & { lines: string[]; errors: string[]; opened: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  const opened: string[] = [];
  return {
    lines,
    errors,
    opened,
    out: (line) => lines.push(line),
    err: (line) => errors.push(line),
    openBrowser: (url) => opened.push(url),
  };
}

describe('parseUiArgs', () => {
  it('defaults to a free port, the browser opened and no path', () => {
    expect(parseUiArgs([])).toEqual({ path: undefined, port: 0, open: true });
  });

  it('reads the path, --port in both forms and --no-open', () => {
    expect(parseUiArgs(['proj', '--port', '4100', '--no-open'])).toEqual({ path: 'proj', port: 4100, open: false });
    expect(parseUiArgs(['--port=4100', 'proj'])).toEqual({ path: 'proj', port: 4100, open: true });
  });

  it('does not take the value of a config flag for the project path', () => {
    expect(parseUiArgs(['--data-dir', 'elsewhere', 'proj']).path).toBe('proj');
  });

  it.each([['abc'], ['70000'], ['-1'], ['4100x'], ['1.5']])('rejects --port %s', (value) => {
    expect(() => parseUiArgs([`--port=${value}`])).toThrow(/--port/);
  });

  it('rejects --port without a value', () => {
    expect(() => parseUiArgs(['--port'])).toThrow(/--port/);
    expect(() => parseUiArgs(['--port', '--no-open'])).toThrow(/--port/);
  });
});

describe('runUiCommand', () => {
  let project: TempProject;

  beforeAll(async () => {
    project = await makeIndexedProject();
  });

  afterAll(() => project?.cleanup());

  it('starts the server, prints its URL and what is unavailable, and opens the browser', async () => {
    const io = recordingIo();
    const server = await runUiCommand([project.projectRoot], project.config, io);
    try {
      expect(server).not.toBeNull();
      const url = server?.url ?? '';
      expect(io.lines.join('\n')).toContain(url);
      expect(io.lines.join('\n')).toMatch(/semantic_search/);
      expect(io.opened).toEqual([url]);
      expect(io.errors).toEqual([]);
      const status = await rawRequest(server?.port ?? 0, '/api/status', { token: server?.token });
      expect(status.json.data.projectRoot).toBe(project.projectRoot);
    } finally {
      await server?.close();
    }
  });

  it('does not open the browser with --no-open', async () => {
    const io = recordingIo();
    const server = await runUiCommand([project.projectRoot, '--no-open'], project.config, io);
    await server?.close();
    expect(server).not.toBeNull();
    expect(io.opened).toEqual([]);
  });

  it('prints the reason and starts nothing for a bad port or a project without an index', async () => {
    const badPort = recordingIo();
    expect(await runUiCommand([project.projectRoot, '--port', 'x'], project.config, badPort)).toBeNull();
    expect(badPort.errors.join('\n')).toMatch(/--port/);

    const noIndex = recordingIo();
    expect(await runUiCommand([join(project.base, 'static'), '--no-open'], project.config, noIndex)).toBeNull();
    expect(noIndex.errors.join('\n')).toMatch(/hesman index/);
    expect(noIndex.opened).toEqual([]);
  });

  it('says so when the port is taken', async () => {
    const first = await runUiCommand([project.projectRoot, '--no-open'], project.config, recordingIo());
    const io = recordingIo();
    try {
      expect(await runUiCommand([project.projectRoot, '--no-open', '--port', String(first?.port)], project.config, io)).toBeNull();
      expect(io.errors.join('\n')).toMatch(/already in use/);
    } finally {
      await first?.close();
    }
  });
});
