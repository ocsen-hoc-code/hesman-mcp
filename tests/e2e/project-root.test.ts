import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, toolText, type HesmanTestServer, type StartServerOptions } from './helpers/server.js';

/**
 * How the server chooses the project to index (M2-02): explicit root → MCP
 * roots → working directory that looks like a project → no project.
 * Every case runs the real binary; none of the non-explicit cases sets
 * `HESMAN_PROJECT_ROOT`.
 */

interface FindSymbolResponse {
  symbols: Array<{ name: string; filePath: string }>;
}

interface ToolError {
  error: { code: string; message: string };
}

describe('E2E — project root detection', () => {
  let base: string;
  let server: HesmanTestServer | undefined;
  let counter = 0;

  beforeAll(() => {
    // realpath: the server reports paths below its real working directory.
    base = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-root-e2e-')));
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  /** Creates a directory with one TypeScript file exporting `symbol`; `marker` makes it look like a project. */
  function makeProject(symbol: string, marker: 'package.json' | '.git' | null = 'package.json'): string {
    const dir = join(base, `${symbol}-${counter++}`);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.ts'), `export function ${symbol}(): string {\n  return '${symbol}';\n}\n`);
    if (marker === '.git') mkdirSync(join(dir, '.git'));
    else if (marker) writeFileSync(join(dir, marker), '{}\n');
    return dir;
  }

  /** Starts the server without `HESMAN_PROJECT_ROOT`, in `cwd`. */
  async function startDetecting(cwd: string, options: StartServerOptions = {}): Promise<HesmanTestServer> {
    server = await startServer({ fixture: cwd, explicitRoot: false, ...options });
    return server;
  }

  async function findSymbol(name: string): Promise<FindSymbolResponse['symbols']> {
    const data = await server!.callToolJson<FindSymbolResponse>('find_symbol', { name, matchMode: 'exact' });
    return data.symbols.filter((s) => s.name === name);
  }

  it('indexes the root reported by the client, not the working directory', async () => {
    const cwdProject = makeProject('cwdOnlySymbol');
    const rootProject = makeProject('rootOnlySymbol');

    await startDetecting(cwdProject, { roots: [rootProject] });

    const found = await findSymbol('rootOnlySymbol');
    expect(found).toHaveLength(1);
    expect(found[0].filePath).toBe(join(rootProject, 'src', 'main.ts'));
    expect(await findSymbol('cwdOnlySymbol')).toEqual([]);
    expect(server!.nonProtocolStdoutLines).toEqual([]);
  }, 60000);

  it('indexes the first of several roots and logs the others', async () => {
    const first = makeProject('firstRootSymbol');
    const second = makeProject('secondRootSymbol');

    await startDetecting(makeProject('unusedCwdSymbol', null), { roots: [first, second] });

    expect(await findSymbol('firstRootSymbol')).toHaveLength(1);
    expect(await findSymbol('secondRootSymbol')).toEqual([]);
    const logs = server!.stderrLines.join('\n');
    expect(logs).toContain(second);
    expect(logs).toMatch(/only the first root is indexed/i);
  }, 60000);

  it('keeps its data dir inside the root reported by the client', async () => {
    const cwdDir = makeProject('plainCwdSymbol', null);
    const rootProject = makeProject('dataDirRootSymbol');

    await startDetecting(cwdDir, { roots: [rootProject], tempDataDir: false });

    expect(existsSync(join(rootProject, '.hesman', 'symbols.db'))).toBe(true);
    expect(existsSync(join(cwdDir, '.hesman'))).toBe(false);
  }, 60000);

  it('switches project when the client reports a different root', async () => {
    const projectA = makeProject('alphaRootSymbol');
    const projectB = makeProject('betaRootSymbol');

    await startDetecting(makeProject('idleCwdSymbol', null), { roots: [projectA], tempDataDir: false });
    expect(await findSymbol('alphaRootSymbol')).toHaveLength(1);

    await server!.setRoots([projectB]);
    await server!.waitForIndex();

    expect(await findSymbol('betaRootSymbol')).toHaveLength(1);
    expect(await findSymbol('alphaRootSymbol')).toEqual([]);
    expect(existsSync(join(projectB, '.hesman', 'symbols.db'))).toBe(true);
    expect(server!.nonProtocolStdoutLines).toEqual([]);
  }, 60000);

  it('lets an explicit root win over the roots reported by the client', async () => {
    const explicitProject = makeProject('explicitRootSymbol');
    const rootProject = makeProject('ignoredRootSymbol');

    server = await startServer({ fixture: explicitProject, roots: [rootProject] });

    expect(await findSymbol('explicitRootSymbol')).toHaveLength(1);
    expect(await findSymbol('ignoredRootSymbol')).toEqual([]);
  }, 60000);

  it('accepts the root through --project-root', async () => {
    const flagProject = makeProject('flagRootSymbol', null);

    await startDetecting(makeProject('otherCwdSymbol'), { extraArgs: ['--project-root', flagProject] });

    expect(await findSymbol('flagRootSymbol')).toHaveLength(1);
    expect(await findSymbol('otherCwdSymbol')).toEqual([]);
  }, 60000);

  it('without roots, indexes the working directory when it looks like a project', async () => {
    const project = makeProject('cwdProjectSymbol', '.git');

    await startDetecting(project);

    const found = await findSymbol('cwdProjectSymbol');
    expect(found).toHaveLength(1);
    expect(found[0].filePath).toBe(join(project, 'src', 'main.ts'));
  }, 60000);

  it('falls back to the working directory when the client advertises roots but never answers', async () => {
    const project = makeProject('silentClientSymbol');

    await startDetecting(project, { roots: 'unanswered' });

    expect(await findSymbol('silentClientSymbol')).toHaveLength(1);
    expect(server!.stderrLines.join('\n')).toMatch(/roots\/list/);
  }, 60000);

  it('shuts down promptly while still waiting for the roots answer', async () => {
    const project = makeProject('neverIndexedSymbol');
    await startDetecting(project, { roots: 'unanswered', waitForIndex: false });
    const transport = server!.transport;

    const started = Date.now();
    await server!.stop();
    const tookMs = Date.now() - started;
    server = undefined;

    expect(tookMs).toBeLessThan(3000);
    expect(transport.stderrLines.join('\n')).toContain('Shutdown complete');
  }, 30000);

  it('started in a directory that is not a project: indexes nothing and tools return the "no project" error', async () => {
    const plainDir = makeProject('notAProjectSymbol', null);

    await startDetecting(plainDir, { waitForIndex: false, tempDataDir: false });

    for (const [tool, args] of [
      ['find_symbol', { name: 'notAProjectSymbol' }],
      ['index_status', {}],
      ['find_pattern', { pattern: 'notAProjectSymbol' }],
    ] as const) {
      const result = await server!.callTool(tool, args);
      expect(result.isError).toBe(true);
      const body = JSON.parse(toolText(result)) as ToolError;
      expect(body.error.code).toBe('NO_PROJECT');
      expect(body.error.message).toContain('--project-root');
      expect(body.error.message).toContain(plainDir);
    }
    expect(existsSync(join(plainDir, '.hesman'))).toBe(false);

    // Still a working MCP server: the tool list is served.
    const { tools } = await server!.client.listTools({}, { timeout: 10000 });
    expect(tools.map((t) => t.name)).toContain('find_symbol');
    expect(server!.nonProtocolStdoutLines).toEqual([]);
  }, 60000);

  it('started from the home directory with no roots: never indexes it', async () => {
    // A home directory that even looks like a project (dotfiles repository).
    const home = makeProject('homeDirSymbol', '.git');
    writeFileSync(join(home, 'package.json'), '{}\n');

    await startDetecting(home, {
      waitForIndex: false,
      tempDataDir: false,
      env: { HOME: home, USERPROFILE: home },
    });

    const result = await server!.callTool('find_symbol', { name: 'homeDirSymbol' });
    expect(result.isError).toBe(true);
    expect((JSON.parse(toolText(result)) as ToolError).error.code).toBe('NO_PROJECT');
    expect(existsSync(join(home, '.hesman'))).toBe(false);
    expect(server!.stderrLines.join('\n')).not.toMatch(/Initial indexing complete/);
  }, 60000);

  it('never indexes the home directory when the client reports it as a root', async () => {
    const home = makeProject('homeRootSymbol', '.git');

    await startDetecting(makeProject('noMarkerCwdSymbol', null), {
      roots: [home],
      waitForIndex: false,
      tempDataDir: false,
      env: { HOME: home, USERPROFILE: home },
    });

    const result = await server!.callTool('find_symbol', { name: 'homeRootSymbol' });
    expect(result.isError).toBe(true);
    expect((JSON.parse(toolText(result)) as ToolError).error.code).toBe('NO_PROJECT');
    expect(existsSync(join(home, '.hesman'))).toBe(false);
  }, 60000);
});
