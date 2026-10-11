import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchFor } from '../../../../src/cli/clients/entry';
import { getClient } from '../../../../src/cli/clients/index';
import type { ClientId, ServerEntry } from '../../../../src/cli/clients/types';
import { runDoctor } from '../../../../src/cli/doctor/doctor';
import type { Check, DoctorEnvironment, DoctorReport, ProbeRequest, ProbeResult } from '../../../../src/cli/doctor/types';
import { FAKE_INSTALLATION, cleanupEnvs, makeEnv, writeFixture, type FakeEnvironment, type FakeEnvironmentOptions } from '../clients/helpers';

afterEach(cleanupEnvs);

const PARSERS_DIR = '/fake/hesman-mcp/parsers';
const GRAMMARS = ['tree-sitter-typescript.wasm', 'tree-sitter-python.wasm', 'tree-sitter-go.wasm'];

interface HarnessOptions extends FakeEnvironmentOptions {
  /** Result of the fake server start; merged over a healthy one. */
  probe?: Partial<ProbeResult>;
  /** HTTP status the fake registry answers with; omitted = the network is unreachable. */
  registryStatus?: number;
  /** Paths of the fake installation that do NOT exist. */
  missing?: string[];
  nodeVersion?: string;
}

interface Harness {
  env: FakeEnvironment;
  machine: DoctorEnvironment;
  lines: string[];
  text: () => string;
  probes: ProbeRequest[];
  fetched: string[];
  run: (...args: string[]) => Promise<number>;
  /** Runs with `--json` and returns the parsed report next to the exit code. */
  json: (...args: string[]) => Promise<{ code: number; report: DoctorReport }>;
}

function harness(options: HarnessOptions = {}): Harness {
  const env = makeEnv(options);
  const lines: string[] = [];
  const probes: ProbeRequest[] = [];
  const fetched: string[] = [];
  const fakePaths = new Set([FAKE_INSTALLATION.execPath, FAKE_INSTALLATION.entryScript, ...GRAMMARS.map((g) => `${PARSERS_DIR}/${g}`)]);
  for (const path of options.missing ?? []) fakePaths.delete(path);

  const machine: DoctorEnvironment = {
    nodeVersion: options.nodeVersion ?? '22.3.0',
    enginesNode: '>=20.0.0',
    parsersDir: PARSERS_DIR,
    grammars: GRAMMARS,
    exists: (path) => fakePaths.has(path) || (!path.startsWith('/fake/') && existsSync(path)),
    probe: async (request) => {
      probes.push(request);
      return {
        handshakeMs: 120,
        timedOut: false,
        server: { name: 'hesman', version: '1.0.0' },
        nonProtocolStdout: [],
        stderrTail: [],
        project: { state: 'opened', root: env.cwd, source: 'working directory' },
        ...options.probe,
      };
    },
    fetchStatus: async (url) => {
      fetched.push(url);
      if (options.registryStatus === undefined) throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
      return options.registryStatus;
    },
  };

  const run = (...args: string[]): Promise<number> => runDoctor(args, { env, out: (line) => lines.push(line) }, machine);
  return {
    env,
    machine,
    lines,
    probes,
    fetched,
    text: () => lines.join('\n'),
    run,
    json: async (...args) => {
      const code = await run('--json', ...args);
      return { code, report: JSON.parse(lines.join('\n')) as DoctorReport };
    },
  };
}

/** Writes the entry `hesman setup` would write for this client right now. */
function configure(h: Harness, id: ClientId, entry?: ServerEntry): void {
  const client = getClient(id, h.env);
  client.write(entry ?? launchFor(client, 'auto', h.env).entry);
}

function snapshot(h: Harness): Record<string, string> {
  const files: Record<string, string> = {};
  for (const dir of [h.env.home, h.env.cwd]) {
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (e.isFile()) files[join(e.parentPath, e.name)] = readFileSync(join(e.parentPath, e.name), 'utf-8');
    }
  }
  return files;
}

function check(report: DoctorReport, client: ClientId, id: string): Check {
  const found = report.clients.find((c) => c.id === client)?.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no ${id} check for ${client} in ${JSON.stringify(report, null, 2)}`);
  return found;
}

const cursorConfig = (h: Harness): string => join(h.env.home, '.cursor', 'mcp.json');

describe('hesman doctor — a healthy setup', () => {
  it('passes every check, exits 0 and starts exactly the configured command', async () => {
    const h = harness();
    configure(h, 'cursor');

    const { code, report } = await h.json();

    expect(code).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.clients.map((c) => c.id)).toEqual(['cursor']);
    expect(report.clients[0].checks.map((c) => [c.id, c.status])).toEqual([
      ['config', 'pass'],
      ['entry', 'pass'],
      ['command', 'pass'],
      ['handshake', 'pass'],
      ['stdout', 'pass'],
      ['project', 'pass'],
    ]);
    expect(h.probes).toEqual([
      { command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript], cwd: h.env.cwd, timeoutMs: 5000 },
    ]);
    expect(check(report, 'cursor', 'handshake').message).toContain('120 ms');
  });

  it('prints one line per check and a summary in text mode', async () => {
    const h = harness();
    configure(h, 'cursor');

    expect(await h.run()).toBe(0);

    expect(h.text()).toContain('Cursor (cursor)');
    expect(h.text()).toContain(cursorConfig(h));
    expect(h.text()).toMatch(/ok\s+MCP `initialize` answered in 120 ms/);
    expect(h.text()).toMatch(/9 passed.*0 failed/s);
  });

  it('never writes, removes or runs anything', async () => {
    const h = harness({ onPath: ['claude', 'codex'] });
    configure(h, 'cursor');
    writeFixture(join(h.env.home, '.codex', 'config.toml'), '[mcp_servers.hesman]\ncommand = "hesman"\nargs = []\ncwd = "/old"\n');
    writeFixture(join(h.env.home, '.claude.json'), '{ not json');
    h.env.calls.length = 0;
    const before = snapshot(h);

    await h.run('--client', 'cursor', 'codex', 'claude-code', 'windsurf');

    expect(snapshot(h)).toEqual(before);
    expect(h.env.calls).toEqual([]);
  });
});

describe('hesman doctor — config file and entry', () => {
  it('fails a named client whose config file does not exist, with the setup command as fix', async () => {
    const h = harness();

    const { code, report } = await h.json('--client', 'cursor');

    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    const config = check(report, 'cursor', 'config');
    expect(config.status).toBe('fail');
    expect(config.message).toContain('does not exist');
    expect(config.message).toContain(cursorConfig(h));
    expect(config.fix).toBe('hesman setup --client cursor');
    expect(h.probes).toEqual([]);
  });

  it('only warns for a client that is detected but was not asked for', async () => {
    const h = harness();
    writeFixture(join(h.env.home, '.cursor', 'marker'), '');

    const { code, report } = await h.json();

    expect(code).toBe(0);
    expect(check(report, 'cursor', 'config').status).toBe('warn');
    expect(check(report, 'cursor', 'config').fix).toBe('hesman setup --client cursor');
  });

  it('fails on a config file that is not valid JSON and names the file', async () => {
    const h = harness();
    writeFixture(cursorConfig(h), '{ "mcpServers": { // comment\n }');

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const config = check(report, 'cursor', 'config');
    expect(config.status).toBe('fail');
    expect(config.message).toContain('Invalid JSON');
    expect(config.message).toContain(cursorConfig(h));
    expect(config.fix).toMatch(/fix the file/i);
    expect(h.probes).toEqual([]);
  });

  it('fails a named client whose config has no hesman entry', async () => {
    const h = harness();
    writeFixture(cursorConfig(h), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));

    const { code, report } = await h.json('--client', 'cursor');

    expect(code).toBe(1);
    expect(check(report, 'cursor', 'config').message).toContain('no `hesman` entry');
    expect(check(report, 'cursor', 'config').fix).toBe('hesman setup --client cursor');
  });

  it('warns when the entry differs from what setup would write now and shows both', async () => {
    const h = harness({ onPath: ['hesman'], pathOf: { hesman: '/usr/local/bin/hesman', node: '/usr/local/bin/node' } });
    configure(h, 'cursor', { command: 'hesman', args: [] });

    const { code, report } = await h.json();

    const entry = check(report, 'cursor', 'entry');
    expect(entry.status).toBe('warn');
    expect(entry.message).toContain('differs');
    expect(entry.fix).toBe('hesman setup --client cursor');
    expect(report.clients[0].configured).toEqual({ command: 'hesman', args: [] });
    expect(report.clients[0].expected).toEqual({ command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript] });
    // The differing command still starts, so this is a warning only.
    expect(code).toBe(0);
  });

  it('warns about a leftover cwd in an otherwise current entry', async () => {
    const h = harness();
    writeFixture(
      cursorConfig(h),
      JSON.stringify({ mcpServers: { hesman: { command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript], cwd: '/old/project' } } }),
    );

    const { code, report } = await h.json();

    expect(code).toBe(0);
    const entry = check(report, 'cursor', 'entry');
    expect(entry.status).toBe('warn');
    expect(entry.message).toContain('cwd');
    expect(entry.fix).toBe('hesman setup --client cursor');
  });

  it('accepts a --project-root added by hand to a current entry', async () => {
    const h = harness();
    const pinned = h.env.cwd;
    configure(h, 'cursor', { command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript, '--project-root', pinned] });

    const { report } = await h.json('--client', 'cursor');

    expect(check(report, 'cursor', 'entry').status).toBe('pass');
    const project = check(report, 'cursor', 'project');
    expect(project.status).toBe('pass');
    expect(project.message).toContain(pinned);
    expect(project.details).toMatchObject({ source: 'explicit', root: pinned });
  });

  it('compares a Claude Desktop entry without counting its pinned project as a difference', async () => {
    const h = harness({ platform: 'darwin' });
    const client = getClient('claude-desktop', h.env);
    client.write(launchFor(client, 'auto', h.env).entry, { projectRoot: join(h.env.home, 'elsewhere') });

    const { report } = await h.json('--client', 'claude-desktop');

    expect(check(report, 'claude-desktop', 'entry').status).toBe('pass');
  });
});

describe('hesman doctor — the configured command', () => {
  it('fails when the Node binary of an absolute entry is gone (Node switched) and does not try to start it', async () => {
    const h = harness();
    configure(h, 'cursor', { command: '/old/node/v18/bin/node', args: [FAKE_INSTALLATION.entryScript] });

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const command = check(report, 'cursor', 'command');
    expect(command.status).toBe('fail');
    expect(command.message).toContain('/old/node/v18/bin/node');
    expect(command.message).toContain('does not exist');
    expect(command.fix).toBe('hesman setup --client cursor');
    expect(check(report, 'cursor', 'handshake').status).toBe('skip');
    expect(check(report, 'cursor', 'stdout').status).toBe('skip');
    expect(h.probes).toEqual([]);
  });

  it('fails when the entry script of an absolute entry is gone (checkout moved)', async () => {
    const h = harness();
    configure(h, 'cursor', { command: FAKE_INSTALLATION.execPath, args: ['/old/checkout/dist/index.js'] });

    const { code, report } = await h.json();

    expect(code).toBe(1);
    expect(check(report, 'cursor', 'command').message).toContain('/old/checkout/dist/index.js');
    expect(check(report, 'cursor', 'command').fix).toBe('hesman setup --client cursor');
  });

  it('fails when a bare command is not on PATH', async () => {
    const h = harness();
    configure(h, 'gemini-cli', { command: 'hesman', args: [] });

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const command = check(report, 'gemini-cli', 'command');
    expect(command.status).toBe('fail');
    expect(command.message).toContain('`hesman` is not on PATH');
    expect(command.fix).toBe('hesman setup --client gemini-cli');
    expect(h.probes).toEqual([]);
  });

  it('warns when a desktop app would not find a command that lives in a version-manager directory', async () => {
    const h = harness({ platform: 'darwin', pathOf: { hesman: '/Users/x/.nvm/versions/node/v22/bin/hesman', node: '/Users/x/.nvm/versions/node/v22/bin/node' } });
    configure(h, 'cursor', { command: 'hesman', args: [] });

    const { code, report } = await h.json();

    const command = check(report, 'cursor', 'command');
    expect(command.status).toBe('warn');
    expect(command.message).toContain('/Users/x/.nvm/versions/node/v22/bin/hesman');
    expect(command.message).toMatch(/desktop app/);
    expect(command.fix).toBe('hesman setup --client cursor --command absolute');
    expect(code).toBe(0);
  });

  it('does not warn a terminal client about the same command', async () => {
    const h = harness({ platform: 'darwin', pathOf: { hesman: '/Users/x/.nvm/versions/node/v22/bin/hesman', node: '/Users/x/.nvm/versions/node/v22/bin/node' } });
    configure(h, 'gemini-cli', { command: 'hesman', args: [] });

    const { report } = await h.json();

    expect(check(report, 'gemini-cli', 'command').status).toBe('pass');
  });

  describe('npx entries', () => {
    const npx = { pathOf: { npx: '/usr/local/bin/npx', node: '/usr/local/bin/node' } };
    const entry: ServerEntry = { command: 'npx', args: ['-y', 'hesman-mcp@1'] };

    it('fails when the registry says the package does not exist, and skips the start', async () => {
      const h = harness({ ...npx, registryStatus: 404 });
      configure(h, 'gemini-cli', entry);

      const { code, report } = await h.json();

      expect(code).toBe(1);
      const command = check(report, 'gemini-cli', 'command');
      expect(command.status).toBe('fail');
      expect(command.message).toContain('hesman-mcp');
      expect(command.message).toContain('not published');
      expect(command.fix).toBe('hesman setup --client gemini-cli --command absolute');
      expect(h.fetched).toEqual(['https://registry.npmjs.org/hesman-mcp']);
      expect(h.probes).toEqual([]);
    });

    it('only warns when the registry cannot be reached (offline never fails)', async () => {
      const h = harness(npx);
      configure(h, 'gemini-cli', entry);

      const { code, report } = await h.json();

      expect(code).toBe(0);
      const command = check(report, 'gemini-cli', 'command');
      expect(command.status).toBe('warn');
      expect(command.message).toContain('2026-10-11');
      expect(h.probes).toHaveLength(1);
    });

    it('passes when the registry has the package', async () => {
      const h = harness({ ...npx, registryStatus: 200 });
      configure(h, 'gemini-cli', entry);

      const { report } = await h.json();

      expect(check(report, 'gemini-cli', 'command').status).toBe('pass');
    });

    it('does not use the network when this Hesman itself runs from an npx cache', async () => {
      const h = harness({ ...npx, registryStatus: 404, installation: { entryScript: '/fake/.npm/_npx/abc/node_modules/hesman-mcp/dist/index.js' } });
      configure(h, 'gemini-cli', entry);

      const { report } = await h.json();

      expect(h.fetched).toEqual([]);
      expect(check(report, 'gemini-cli', 'command').status).toBe('pass');
    });
  });
});

describe('hesman doctor — starting the server', () => {
  it('reports a crash on start with the exit code and the last stderr lines', async () => {
    const h = harness({
      probe: { handshakeMs: undefined, exit: { code: 1, signal: null }, stderrTail: ['Error: Cannot find module zvec'], project: { state: 'unknown', reason: 'the server did not start' } },
    });
    configure(h, 'cursor');

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const handshake = check(report, 'cursor', 'handshake');
    expect(handshake.status).toBe('fail');
    expect(handshake.message).toContain('exited with code 1');
    expect(handshake.message).toContain('Cannot find module zvec');
    expect(handshake.fix).toContain(`${FAKE_INSTALLATION.execPath} ${FAKE_INSTALLATION.entryScript}`);
  });

  it('reports a command that could not be spawned', async () => {
    const h = harness({ probe: { handshakeMs: undefined, spawnError: 'spawn EACCES', project: { state: 'unknown', reason: 'the server did not start' } } });
    configure(h, 'cursor');

    const { code, report } = await h.json();

    expect(code).toBe(1);
    expect(check(report, 'cursor', 'handshake').message).toContain('spawn EACCES');
  });

  it('reports a slow start as a timeout with the limit', async () => {
    const h = harness({ probe: { handshakeMs: undefined, timedOut: true, project: { state: 'unknown', reason: 'the server did not start' } } });
    configure(h, 'cursor');

    const { code, report } = await h.json('--timeout', '1500');

    expect(code).toBe(1);
    expect(h.probes[0].timeoutMs).toBe(1500);
    const handshake = check(report, 'cursor', 'handshake');
    expect(handshake.status).toBe('fail');
    expect(handshake.message).toContain('no answer to `initialize` within 1500 ms');
    expect(handshake.details).toMatchObject({ timeoutMs: 1500 });
  });

  it('reports the measured handshake time', async () => {
    const h = harness({ probe: { handshakeMs: 431 } });
    configure(h, 'cursor');

    const { report } = await h.json();

    expect(check(report, 'cursor', 'handshake').details).toMatchObject({ ms: 431, timeoutMs: 5000 });
  });

  it('fails on stdout lines that are not JSON-RPC and quotes the first one', async () => {
    const h = harness({ probe: { nonProtocolStdout: ['[info] Starting Hesman', 'another line'] } });
    configure(h, 'cursor');

    const { code, report } = await h.json();

    expect(code).toBe(1);
    expect(check(report, 'cursor', 'handshake').status).toBe('pass');
    const stdout = check(report, 'cursor', 'stdout');
    expect(stdout.status).toBe('fail');
    expect(stdout.message).toContain('2 line(s)');
    expect(stdout.message).toContain('[info] Starting Hesman');
    expect(stdout.fix).toBe('hesman setup --client cursor');
  });
});

describe('hesman doctor — which project', () => {
  it('says which directory is indexed when started here without client roots', async () => {
    const h = harness();
    configure(h, 'cursor');

    const { report } = await h.json();

    const project = check(report, 'cursor', 'project');
    expect(project.message).toContain(h.env.cwd);
    expect(project.message).toMatch(/without client roots/);
    expect(project.details).toMatchObject({ source: 'working directory', root: h.env.cwd, testedFrom: h.env.cwd });
  });

  it('warns about NO_PROJECT from this directory without calling it a failure', async () => {
    const h = harness({ probe: { project: { state: 'none' } } });
    configure(h, 'gemini-cli');

    const { code, report } = await h.json();

    expect(code).toBe(0);
    const project = check(report, 'gemini-cli', 'project');
    expect(project.status).toBe('warn');
    expect(project.message).toContain('NO_PROJECT');
    expect(project.message).toContain(h.env.cwd);
    expect(project.fix).toContain('--project-root');
    expect(project.details).toMatchObject({ source: 'none' });
  });

  it('fails a Claude Desktop entry that names no project, because that client has no workspace', async () => {
    const h = harness({ platform: 'darwin', probe: { project: { state: 'none' } } });
    writeFixture(
      getClient('claude-desktop', h.env).configPath(),
      JSON.stringify({ mcpServers: { hesman: { command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript] } } }),
    );

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const project = check(report, 'claude-desktop', 'project');
    expect(project.status).toBe('fail');
    expect(project.message).toContain('NO_PROJECT');
    expect(project.fix).toBe('hesman setup --client claude-desktop --project-root <path>');
  });

  it('starts the server in the cwd an old entry still carries, because that is where the client starts it', async () => {
    const h = harness({ platform: 'darwin' });
    const old = join(h.env.home, 'old-project');
    writeFixture(join(old, 'package.json'), '{}');
    writeFixture(
      getClient('claude-desktop', h.env).configPath(),
      JSON.stringify({ mcpServers: { hesman: { command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript], cwd: old } } }),
    );

    const { report } = await h.json();

    expect(h.probes[0].cwd).toBe(old);
    const project = check(report, 'claude-desktop', 'project');
    expect(project.status).toBe('pass');
    expect(project.message).toContain(`Started in ${old}`);
    expect(project.details).toMatchObject({ testedFrom: old });
  });

  it('reads the cwd of a Codex TOML entry too', async () => {
    const h = harness();
    const old = join(h.env.home, 'old-project');
    writeFixture(join(old, 'package.json'), '{}');
    writeFixture(
      join(h.env.home, '.codex', 'config.toml'),
      `[mcp_servers.other]\ncwd = "/not/this"\n\n[mcp_servers.hesman]\ncommand = "${FAKE_INSTALLATION.execPath}"\nargs = ["${FAKE_INSTALLATION.entryScript}"]\ncwd = "${old}"\n`,
    );

    const { report } = await h.json();

    expect(h.probes[0].cwd).toBe(old);
    expect(check(report, 'codex', 'entry').message).toContain('cwd');
  });

  it('fails when the pinned project directory does not exist', async () => {
    const h = harness();
    configure(h, 'cursor', { command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript, '--project-root', '/fake/gone'] });

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const project = check(report, 'cursor', 'project');
    expect(project.status).toBe('fail');
    expect(project.message).toContain('/fake/gone');
  });

  it('does not start the server with a variable only the client can expand', async () => {
    const h = harness();
    configure(h, 'cursor', { command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript, '--project-root', '${workspaceFolder}'] });

    const { report } = await h.json();

    expect(h.probes[0].args).toEqual([FAKE_INSTALLATION.entryScript]);
    const project = check(report, 'cursor', 'project');
    expect(project.status).toBe('warn');
    expect(project.message).toContain('${workspaceFolder}');
  });

  it.each(['antigravity', 'windsurf', 'cursor'] as const)('says what stays unverifiable for %s', async (id) => {
    const h = harness();
    configure(h, id);

    const { report } = await h.json('--client', id);
    const client = report.clients[0];

    expect(client.unverifiable.join(' ')).toMatch(/unverified|not documented/i);
    expect(client.unverifiable.join(' ')).toContain('NO_PROJECT');

    const t = harness();
    configure(t, id);
    await t.run('--client', id);
    expect(t.text()).toContain('not verifiable');
  });

  it('has nothing unverifiable to say about a pinned Claude Desktop entry', async () => {
    const h = harness({ platform: 'darwin' });
    const client = getClient('claude-desktop', h.env);
    client.write(launchFor(client, 'auto', h.env).entry);

    const { report } = await h.json();

    expect(check(report, 'claude-desktop', 'project').status).toBe('pass');
    expect(report.clients[0].unverifiable).toEqual([]);
  });
});

describe('hesman doctor — this installation', () => {
  it('passes the three server checks on a complete installation', async () => {
    const h = harness();

    const { code, report } = await h.json();

    expect(code).toBe(0);
    expect(report.server.checks.map((c) => [c.id, c.status])).toEqual([
      ['entry-script', 'pass'],
      ['node', 'pass'],
      ['parsers', 'pass'],
    ]);
    expect(report.version).toBe(FAKE_INSTALLATION.version);
  });

  it('fails when the entry script is not built', async () => {
    const h = harness({ missing: [FAKE_INSTALLATION.entryScript] });

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const entry = report.server.checks.find((c) => c.id === 'entry-script')!;
    expect(entry.status).toBe('fail');
    expect(entry.message).toContain(FAKE_INSTALLATION.entryScript);
    expect(entry.fix).toContain('npm run build');
  });

  it('fails when Node is older than engines allows', async () => {
    const h = harness({ nodeVersion: '18.19.1' });

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const node = report.server.checks.find((c) => c.id === 'node')!;
    expect(node.status).toBe('fail');
    expect(node.message).toContain('18.19.1');
    expect(node.message).toContain('>=20.0.0');
  });

  it('fails and names a missing parser', async () => {
    const h = harness({ missing: [`${PARSERS_DIR}/tree-sitter-go.wasm`] });

    const { code, report } = await h.json();

    expect(code).toBe(1);
    const parsers = report.server.checks.find((c) => c.id === 'parsers')!;
    expect(parsers.status).toBe('fail');
    expect(parsers.message).toContain('tree-sitter-go.wasm');
    expect(parsers.message).not.toContain('tree-sitter-python.wasm');
    expect(parsers.fix).toContain('download-parsers');
  });
});

describe('hesman doctor — options and output', () => {
  it('says so when no client is detected and still checks the installation', async () => {
    const h = harness();

    expect(await h.run()).toBe(0);

    expect(h.text()).toContain('No supported client was detected');
    expect(h.text()).toContain('This installation');
  });

  it('--json prints exactly one JSON object with the summary counts', async () => {
    const h = harness({ probe: { nonProtocolStdout: ['oops'] } });
    configure(h, 'cursor');

    const { report } = await h.json();

    expect(report.summary).toEqual({ pass: 8, warn: 0, fail: 1, skip: 0 });
    expect(report.clients[0]).toMatchObject({ id: 'cursor', label: 'Cursor', kind: 'gui', detected: true, configPath: cursorConfig(h), status: 'fail' });
  });

  it('accepts aliases and comma-separated names like setup does', async () => {
    const h = harness();

    const { report } = await h.json('--client', 'gemini,codex');

    expect(report.clients.map((c) => c.id)).toEqual(['gemini-cli', 'codex']);
  });

  it.each([
    [['--client', 'nope'], 'Unknown client "nope"'],
    [['--client', 'claude'], 'ambiguous'],
    [['--fix'], 'Unknown argument: --fix'],
    [['--timeout', 'soon'], '--timeout'],
    [['--client'], '--client needs a name'],
  ])('rejects %j', async (args, message) => {
    const h = harness();

    expect(await h.run(...args)).toBe(1);

    expect(h.text()).toContain(message);
    expect(h.probes).toEqual([]);
  });
});
