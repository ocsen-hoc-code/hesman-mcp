import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serverEntry } from '../../../../src/cli/clients/entry';
import { allClients, getClient } from '../../../../src/cli/clients/index';
import type { ClientId, Scope } from '../../../../src/cli/clients/types';
import { PLATFORMS, cleanupEnvs, makeEnv, writeFixture, type FakeEnvironment, type TestPlatform } from './helpers';

afterEach(cleanupEnvs);

interface Case {
  id: ClientId;
  /** Config path under the temp home (user scope) per platform. */
  userPath: Record<TestPlatform, string[]>;
  /** Top-level key holding the servers. */
  key: 'mcpServers' | 'servers';
  /** The exact hesman entry the client must get, given the environment. */
  entry: (env: FakeEnvironment, scope: Scope) => Record<string, unknown>;
  projectPath?: string[];
}

const same = (segments: string[]): Record<TestPlatform, string[]> => ({ darwin: segments, linux: segments, win32: segments });
const plain = (): Record<string, unknown> => ({ command: 'hesman', args: [] });

const CASES: Case[] = [
  {
    id: 'claude-code',
    userPath: same(['.claude.json']),
    key: 'mcpServers',
    entry: () => ({ type: 'stdio', command: 'hesman', args: [] }),
    projectPath: ['.mcp.json'],
  },
  {
    id: 'claude-desktop',
    userPath: {
      darwin: ['Library', 'Application Support', 'Claude', 'claude_desktop_config.json'],
      linux: ['.config', 'Claude', 'claude_desktop_config.json'],
      win32: ['AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'],
    },
    key: 'mcpServers',
    entry: (env) => ({ command: 'hesman', args: ['--project-root', env.cwd] }),
  },
  {
    id: 'cursor',
    userPath: same(['.cursor', 'mcp.json']),
    key: 'mcpServers',
    entry: () => ({ command: 'hesman', args: ['--project-root', '${workspaceFolder}'] }),
    projectPath: ['.cursor', 'mcp.json'],
  },
  {
    id: 'antigravity',
    userPath: same(['.gemini', 'config', 'mcp_config.json']),
    key: 'mcpServers',
    entry: plain,
    projectPath: ['.agents', 'mcp_config.json'],
  },
  {
    id: 'vscode',
    userPath: {
      darwin: ['Library', 'Application Support', 'Code', 'User', 'mcp.json'],
      linux: ['.config', 'Code', 'User', 'mcp.json'],
      win32: ['AppData', 'Roaming', 'Code', 'User', 'mcp.json'],
    },
    key: 'servers',
    entry: () => ({ type: 'stdio', command: 'hesman', args: [] }),
    projectPath: ['.vscode', 'mcp.json'],
  },
  {
    id: 'gemini-cli',
    userPath: same(['.gemini', 'settings.json']),
    key: 'mcpServers',
    entry: plain,
    projectPath: ['.gemini', 'settings.json'],
  },
  {
    id: 'windsurf',
    userPath: {
      darwin: ['.config', 'devin', 'mcp_config.json'],
      linux: ['.config', 'devin', 'mcp_config.json'],
      win32: ['AppData', 'Roaming', 'devin', 'mcp_config.json'],
    },
    key: 'mcpServers',
    entry: plain,
  },
];

const golden = (key: string, servers: Record<string, unknown>): string => JSON.stringify({ [key]: servers }, null, 2) + '\n';

describe.each(CASES)('$id (config file)', (c) => {
  describe.each(PLATFORMS)('on %s', (platform) => {
    const setup = () => {
      const env = makeEnv({ platform });
      const client = getClient(c.id, env);
      const path = join(env.home, ...c.userPath[platform]);
      return { env, client, path };
    };

    it('uses the documented user-level config path', () => {
      const { client, path } = setup();
      expect(client.configPath('user')).toBe(path);
    });

    it('creates the config with exactly the expected entry, then remove deletes the file it created', () => {
      const { env, client, path } = setup();

      const added = client.write(serverEntry());

      expect(added.status).toBe('added');
      expect(added.via).toBe('file');
      expect(readFileSync(path, 'utf-8')).toBe(golden(c.key, { hesman: c.entry(env, 'user') }));
      expect(client.read()).toEqual({ command: 'hesman', args: c.entry(env, 'user').args });

      const removed = client.remove();

      expect(removed.status).toBe('removed');
      expect(existsSync(path)).toBe(false);
    });

    it('adds next to other servers (golden after) and remove restores the file byte for byte', () => {
      const { env, client, path } = setup();
      const others = { alpha: { command: 'alpha', args: ['--x'], env: { TOKEN: 'abc' } } };
      const before = JSON.stringify({ theme: 'dark', [c.key]: others }, null, 2) + '\n';
      writeFixture(path, before);

      client.write(serverEntry());

      expect(readFileSync(path, 'utf-8')).toBe(
        JSON.stringify({ theme: 'dark', [c.key]: { ...others, hesman: c.entry(env, 'user') } }, null, 2) + '\n',
      );
      expect(readFileSync(`${path}.hesman.bak`, 'utf-8')).toBe(before);

      client.remove();

      expect(readFileSync(path, 'utf-8')).toBe(before);
    });

    it.each([
      ['compact JSON without a trailing newline', (key: string) => `{"${key}":{"alpha":{"command":"alpha"}},"x":1}`],
      ['tab-indented JSON', (key: string) => `{\n\t"${key}": {\n\t\t"alpha": { "command": "alpha" }\n\t}\n}\n`],
      ['a config without the servers key', () => '{\n    "theme": "dark"\n}\n'],
      ['an empty servers object', (key: string) => `{ "${key}": { } }\n`],
      ['an empty file', () => ''],
    ])('setup then remove leaves %s byte-identical', (_name, make) => {
      const { client, path } = setup();
      const before = make(c.key);
      writeFixture(path, before);

      expect(client.write(serverEntry()).status).toBe('added');
      expect(JSON.parse(readFileSync(path, 'utf-8'))[c.key].hesman).toBeDefined();
      client.remove();

      expect(readFileSync(path, 'utf-8')).toBe(before);
    });

    it('a second setup changes nothing', () => {
      const { client, path } = setup();
      writeFixture(path, golden(c.key, { alpha: { command: 'alpha' } }));
      client.write(serverEntry());
      const after = readFileSync(path, 'utf-8');
      const backup = readFileSync(`${path}.hesman.bak`, 'utf-8');

      const second = client.write(serverEntry());

      expect(second.status).toBe('unchanged');
      expect(readFileSync(path, 'utf-8')).toBe(after);
      expect(readFileSync(`${path}.hesman.bak`, 'utf-8')).toBe(backup);
    });

    it('dry run reports the change and writes nothing', () => {
      const { env, client, path } = setup();

      const result = client.write(serverEntry(), { dryRun: true });

      expect(result.status).toBe('added');
      expect(result.applied).toBe(false);
      expect(result.preview).toContain('"hesman"');
      expect(result.configPath).toBe(path);
      expect(existsSync(path)).toBe(false);
      // Not even the parent directories are created.
      expect(readdirSync(env.home)).toEqual([]);
    });
  });

  it('replaces a stale entry (old command, old cwd) and keeps the other servers', () => {
    const env = makeEnv();
    const client = getClient(c.id, env);
    const path = client.configPath('user');
    writeFixture(path, golden(c.key, {
      hesman: { command: 'old-hesman', args: ['--old'], cwd: '/somewhere' },
      alpha: { command: 'alpha' },
    }));

    const result = client.write(serverEntry());

    expect(result.status).toBe('updated');
    const written = JSON.parse(readFileSync(path, 'utf-8'));
    expect(written[c.key].hesman).toEqual(c.entry(env, 'user'));
    expect(written[c.key].alpha).toEqual({ command: 'alpha' });
  });

  it('removes only the hesman entry when the file changed after setup', () => {
    const env = makeEnv();
    const client = getClient(c.id, env);
    const path = client.configPath('user');
    writeFixture(path, golden(c.key, { alpha: { command: 'alpha' } }));
    client.write(serverEntry());
    const edited = JSON.parse(readFileSync(path, 'utf-8'));
    edited[c.key].beta = { command: 'beta' };
    writeFixture(path, JSON.stringify(edited, null, 2) + '\n');

    client.remove();

    expect(readFileSync(path, 'utf-8')).toBe(golden(c.key, { alpha: { command: 'alpha' }, beta: { command: 'beta' } }));
  });

  it('remove reports "absent" and touches nothing when there is no hesman entry', () => {
    const env = makeEnv();
    const client = getClient(c.id, env);
    const path = client.configPath('user');
    const before = golden(c.key, { alpha: { command: 'alpha' } });
    writeFixture(path, before);

    expect(client.remove().status).toBe('absent');
    expect(readFileSync(path, 'utf-8')).toBe(before);
    expect(readdirSync(dirname(path)).filter((f) => f.includes('.hesman.bak') || f.includes('.tmp-'))).toEqual([]);
  });

  it('refuses invalid JSON and leaves the file untouched, with no backup or temp file', () => {
    const env = makeEnv();
    const client = getClient(c.id, env);
    const path = client.configPath('user');
    const broken = `{ "${c.key}": { oops `;
    writeFixture(path, broken);

    expect(() => client.write(serverEntry())).toThrow(/Invalid JSON/);

    expect(readFileSync(path, 'utf-8')).toBe(broken);
    expect(readdirSync(dirname(path)).filter((f) => f.includes('.hesman.bak') || f.includes('.tmp-'))).toEqual([]);
  });

  it('generated entries never contain a cwd', () => {
    const env = makeEnv();
    const client = getClient(c.id, env);
    client.write(serverEntry());
    expect(JSON.parse(readFileSync(client.configPath('user'), 'utf-8'))[c.key].hesman).not.toHaveProperty('cwd');
  });

  if (c.projectPath) {
    const projectPath = c.projectPath;
    it('project scope writes into the working directory and round-trips', () => {
      const env = makeEnv();
      const client = getClient(c.id, env);
      const path = join(env.cwd, ...projectPath);
      expect(client.scopes).toContain('project');
      expect(client.configPath('project')).toBe(path);

      client.write(serverEntry(), { scope: 'project' });

      expect(readFileSync(path, 'utf-8')).toBe(golden(c.key, { hesman: c.entry(env, 'project') }));
      expect(existsSync(client.configPath('user'))).toBe(false);
      client.remove({ scope: 'project' });
      expect(existsSync(path)).toBe(false);
    });
  } else {
    it('has no project scope', () => {
      const client = getClient(c.id, makeEnv());
      expect(client.scopes).toEqual(['user']);
      expect(() => client.write(serverEntry(), { scope: 'project' })).toThrow(/project scope/);
    });
  }
});

describe('VS Code regression (M2-03)', () => {
  it('writes "servers" with type "stdio", never "mcpServers"', () => {
    const env = makeEnv();
    const client = getClient('vscode', env);

    client.write(serverEntry(), { scope: 'project' });

    const written = JSON.parse(readFileSync(join(env.cwd, '.vscode', 'mcp.json'), 'utf-8'));
    expect(written).toEqual({ servers: { hesman: { type: 'stdio', command: 'hesman', args: [] } } });
    expect(written).not.toHaveProperty('mcpServers');
  });
});

describe('client-specific paths and entries', () => {
  it('Claude Desktop pins the project given with projectRoot and says it serves only that project', () => {
    const env = makeEnv({ platform: 'darwin' });
    const client = getClient('claude-desktop', env);
    const project = join(env.home, 'work', 'app');

    const result = client.write(serverEntry(), { projectRoot: project });

    expect(client.read()?.args).toEqual(['--project-root', project]);
    expect(result.notes.join('\n')).toContain(`always use ${project}`);
  });

  it('Claude Desktop refuses the home directory as its project', () => {
    const env = makeEnv({ platform: 'darwin' });
    const client = getClient('claude-desktop', env);
    expect(() => client.write(serverEntry(), { projectRoot: env.home })).toThrow(/--project-root/);
  });

  it('Claude Desktop on Windows falls back to <home>/AppData/Roaming when APPDATA is unset', () => {
    const env = makeEnv({ platform: 'win32', env: { APPDATA: undefined } });
    expect(getClient('claude-desktop', env).configPath()).toBe(
      join(env.home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    );
  });

  it('clients under ~/.config honor XDG_CONFIG_HOME on Linux', () => {
    const env = makeEnv({ platform: 'linux' });
    env.env.XDG_CONFIG_HOME = join(env.home, 'xdg');
    expect(getClient('vscode', env).configPath()).toBe(join(env.home, 'xdg', 'Code', 'User', 'mcp.json'));
    expect(getClient('windsurf', env).configPath()).toBe(join(env.home, 'xdg', 'devin', 'mcp_config.json'));
  });

  it('Windsurf keeps using the legacy ~/.codeium/windsurf file when only that one exists', () => {
    const env = makeEnv({ platform: 'darwin' });
    const legacy = join(env.home, '.codeium', 'windsurf', 'mcp_config.json');
    writeFixture(legacy, '{}\n');
    expect(getClient('windsurf', env).configPath()).toBe(legacy);
  });

  it('Antigravity keeps using the legacy ~/.gemini/antigravity file when only that one exists', () => {
    const env = makeEnv({ platform: 'darwin' });
    const legacy = join(env.home, '.gemini', 'antigravity', 'mcp_config.json');
    writeFixture(legacy, '{}\n');
    expect(getClient('antigravity', env).configPath()).toBe(legacy);
  });

  it.each(['antigravity', 'windsurf'] as const)('%s adds a note that its project detection is unverified', (id) => {
    const result = getClient(id, makeEnv()).write(serverEntry(), { dryRun: true });
    expect(result.notes.join('\n')).toMatch(/unverified/i);
    expect(result.notes.join('\n')).toMatch(/hesman doctor/);
  });

  it('Claude Code honors CLAUDE_CONFIG_DIR', () => {
    const env = makeEnv();
    env.env.CLAUDE_CONFIG_DIR = join(env.home, 'cc');
    expect(getClient('claude-code', env).configPath()).toBe(join(env.home, 'cc', '.claude.json'));
  });
});

describe('detection', () => {
  it('detects nothing in an empty home with an empty PATH', () => {
    expect(allClients(makeEnv()).filter((c) => c.detect()).map((c) => c.id)).toEqual([]);
  });

  it('knows exactly the eight supported clients', () => {
    expect(allClients(makeEnv()).map((c) => c.id)).toEqual([
      'claude-code', 'claude-desktop', 'codex', 'cursor', 'antigravity', 'vscode', 'gemini-cli', 'windsurf',
    ]);
  });

  it.each([
    ['claude-code', ['.claude']],
    ['codex', ['.codex']],
    ['cursor', ['.cursor']],
    ['antigravity', ['.gemini', 'antigravity']],
    ['gemini-cli', ['.gemini', 'settings.json']],
    ['windsurf', ['.codeium', 'windsurf']],
    ['vscode', ['.config', 'Code', 'User']],
    ['claude-desktop', ['.config', 'Claude']],
  ] as const)('detects %s from its files in the home', (id, segments) => {
    const env = makeEnv({ platform: 'linux' });
    const target = join(env.home, ...segments);
    writeFixture(target.endsWith('.json') ? target : join(target, 'marker'), '{}');
    expect(getClient(id, env).detect()).toBe(true);
  });

  it.each([
    ['claude-code', 'claude'],
    ['codex', 'codex'],
    ['gemini-cli', 'gemini'],
    ['vscode', 'code'],
    ['cursor', 'cursor'],
  ] as const)('detects %s from its CLI on PATH', (id, bin) => {
    expect(getClient(id, makeEnv({ onPath: [bin] })).detect()).toBe(true);
  });
});
