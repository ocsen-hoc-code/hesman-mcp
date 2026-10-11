import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serverEntry } from '../../../../src/cli/clients/entry';
import { getClient } from '../../../../src/cli/clients/index';
import { PLATFORMS, cleanupEnvs, makeEnv, writeFixture } from './helpers';

afterEach(cleanupEnvs);

const BLOCK = '[mcp_servers.hesman]\ncommand = "hesman"\nargs = []\n';

const USER_CONFIG = `# Codex settings — keep my comments!
model = "gpt-5"   # trailing comment

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.context7.env]
TOKEN = "abc"

[profiles.fast]
model = "gpt-5-mini"
`;

describe.each(PLATFORMS)('codex (config file) on %s', (platform) => {
  const setup = () => {
    const env = makeEnv({ platform });
    const client = getClient('codex', env);
    return { env, client, path: join(env.home, '.codex', 'config.toml') };
  };

  it('uses ~/.codex/config.toml', () => {
    const { client, path } = setup();
    expect(client.configPath('user')).toBe(path);
  });

  it('creates the file with exactly the hesman table, then remove deletes the file it created', () => {
    const { client, path } = setup();

    const added = client.write(serverEntry());

    expect(added.status).toBe('added');
    expect(added.via).toBe('file');
    expect(readFileSync(path, 'utf-8')).toBe(BLOCK);
    expect(client.read()).toEqual({ command: 'hesman', args: [] });

    expect(client.remove().status).toBe('removed');
    expect(existsSync(path)).toBe(false);
  });

  it('appends the table and leaves every other byte untouched (golden after), remove restores the file', () => {
    const { client, path } = setup();
    writeFixture(path, USER_CONFIG);

    client.write(serverEntry());

    expect(readFileSync(path, 'utf-8')).toBe(`${USER_CONFIG}\n${BLOCK}`);
    expect(readFileSync(`${path}.hesman.bak`, 'utf-8')).toBe(USER_CONFIG);

    client.remove();

    expect(readFileSync(path, 'utf-8')).toBe(USER_CONFIG);
  });

  it.each([
    ['a file without a trailing newline', 'model = "gpt-5"'],
    ['a CRLF file', 'model = "gpt-5"\r\n\r\n[profiles.fast]\r\nmodel = "x"\r\n'],
    ['an empty file', ''],
    ['a file ending in blank lines', 'model = "gpt-5"\n\n\n'],
    ['a comment-only file', '# nothing here yet\n'],
  ])('setup then remove leaves %s byte-identical', (_name, before) => {
    const { client, path } = setup();
    writeFixture(path, before);

    expect(client.write(serverEntry()).status).toBe('added');
    expect(client.read()).toEqual({ command: 'hesman', args: [] });
    client.remove();

    expect(readFileSync(path, 'utf-8')).toBe(before);
  });
});

describe('codex TOML editing', () => {
  const setup = () => {
    const env = makeEnv();
    const client = getClient('codex', env);
    return { env, client, path: client.configPath('user') };
  };

  it('honors CODEX_HOME', () => {
    const env = makeEnv();
    env.env.CODEX_HOME = join(env.home, 'cx');
    expect(getClient('codex', env).configPath()).toBe(join(env.home, 'cx', 'config.toml'));
  });

  it('a second setup changes nothing', () => {
    const { client, path } = setup();
    writeFixture(path, USER_CONFIG);
    client.write(serverEntry());
    const after = readFileSync(path, 'utf-8');

    expect(client.write(serverEntry()).status).toBe('unchanged');
    expect(readFileSync(path, 'utf-8')).toBe(after);
    expect(readFileSync(`${path}.hesman.bak`, 'utf-8')).toBe(USER_CONFIG);
  });

  it('removes only the hesman table when the file changed after setup', () => {
    const { client, path } = setup();
    writeFixture(path, USER_CONFIG);
    client.write(serverEntry());
    const appended = '\n# added later\n[mcp_servers.later]\ncommand = "later"\n';
    writeFixture(path, readFileSync(path, 'utf-8') + appended);

    client.remove();

    expect(readFileSync(path, 'utf-8')).toBe(USER_CONFIG + appended);
  });

  it('removes a hesman table in the middle of the file together with its sub-tables', () => {
    const { client, path } = setup();
    writeFixture(path, [
      'model = "gpt-5"',
      '',
      '[mcp_servers.hesman]',
      'command = "hesman"',
      'args = []',
      '',
      '[mcp_servers.hesman.env]',
      'HESMAN_LOG_LEVEL = "debug"',
      '',
      '# the profile I use',
      '[profiles.fast]',
      'model = "x"',
      '',
    ].join('\n'));

    client.remove();

    expect(readFileSync(path, 'utf-8')).toBe('model = "gpt-5"\n\n# the profile I use\n[profiles.fast]\nmodel = "x"\n');
  });

  it('updates a stale entry in place and keeps comments, other keys and sub-tables', () => {
    const { client, path } = setup();
    writeFixture(path, [
      '[mcp_servers.hesman] # mine',
      "command = '/old/bin/hesman'  # old path",
      'args = [',
      '  "--old",',
      ']',
      'startup_timeout_sec = 20',
      '',
      '[mcp_servers.hesman.env]',
      'HESMAN_LOG_LEVEL = "debug"',
      '',
      '[mcp_servers.other]',
      'command = "other"',
      '',
    ].join('\n'));

    const result = client.write(serverEntry());

    expect(result.status).toBe('updated');
    expect(readFileSync(path, 'utf-8')).toBe([
      '[mcp_servers.hesman] # mine',
      'command = "hesman"',
      'args = []',
      'startup_timeout_sec = 20',
      '',
      '[mcp_servers.hesman.env]',
      'HESMAN_LOG_LEVEL = "debug"',
      '',
      '[mcp_servers.other]',
      'command = "other"',
      '',
    ].join('\n'));
  });

  it('reads command and args, including literal strings, escapes and multi-line arrays', () => {
    const { client, path } = setup();
    writeFixture(path, '[mcp_servers."hesman"]\ncommand = \'C:\\bin\\hesman.cmd\'\nargs = [\n  "--project-root", # why\n  "a \\"b\\"",\n]\n');
    expect(client.read()).toEqual({ command: 'C:\\bin\\hesman.cmd', args: ['--project-root', 'a "b"'] });
  });

  it('writes strings as TOML basic strings', () => {
    const { client, path } = setup();
    client.write({ command: 'C:\\Program Files\\node.exe', args: ['a "b"', '-y'] });
    expect(readFileSync(path, 'utf-8')).toBe(
      '[mcp_servers.hesman]\ncommand = "C:\\\\Program Files\\\\node.exe"\nargs = ["a \\"b\\"", "-y"]\n',
    );
    expect(client.read()).toEqual({ command: 'C:\\Program Files\\node.exe', args: ['a "b"', '-y'] });
  });

  it('ignores a header-looking line inside a multi-line string of another table', () => {
    const { client, path } = setup();
    const before = '[notes]\ntext = """\n[mcp_servers.hesman]\ncommand = "fake"\n"""\n';
    writeFixture(path, before);

    expect(client.read()).toBeUndefined();
    expect(client.write(serverEntry()).status).toBe('added');
    client.remove();
    expect(readFileSync(path, 'utf-8')).toBe(before);
  });

  it.each([
    ['an inline table', '[mcp_servers]\nhesman = { command = "hesman" }\n'],
    ['a dotted key', 'mcp_servers.hesman.command = "hesman"\n'],
    ['dotted keys under [mcp_servers]', '[mcp_servers]\nhesman.command = "hesman"\n'],
  ])('refuses %s it cannot edit safely and leaves the file untouched', (_name, before) => {
    const { client, path } = setup();
    writeFixture(path, before);

    expect(() => client.write(serverEntry())).toThrow(/edit .*by hand/i);
    expect(() => client.remove()).toThrow(/edit .*by hand/i);

    expect(readFileSync(path, 'utf-8')).toBe(before);
    expect(readdirSync(dirname(path)).filter((f) => f.includes('.hesman.bak') || f.includes('.tmp-'))).toEqual([]);
  });

  it('dry run reports the change and writes nothing', () => {
    const { client, path } = setup();

    const result = client.write(serverEntry(), { dryRun: true });

    expect(result.status).toBe('added');
    expect(result.applied).toBe(false);
    expect(result.preview).toContain('[mcp_servers.hesman]');
    expect(existsSync(dirname(path))).toBe(false);
  });

  it('remove reports "absent" and touches nothing when there is no hesman table', () => {
    const { client, path } = setup();
    writeFixture(path, USER_CONFIG);

    expect(client.remove().status).toBe('absent');
    expect(readFileSync(path, 'utf-8')).toBe(USER_CONFIG);
    expect(readdirSync(dirname(path))).toEqual(['config.toml']);
  });

  it('project scope writes .codex/config.toml in the working directory', () => {
    const { env, client } = setup();
    const path = join(env.cwd, '.codex', 'config.toml');
    expect(client.configPath('project')).toBe(path);

    client.write(serverEntry(), { scope: 'project' });

    expect(readFileSync(path, 'utf-8')).toBe(BLOCK);
    expect(existsSync(client.configPath('user'))).toBe(false);
  });
});
