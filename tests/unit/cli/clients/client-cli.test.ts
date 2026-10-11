import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { serverEntry } from '../../../../src/cli/clients/entry';
import { getClient } from '../../../../src/cli/clients/index';
import { cleanupEnvs, makeEnv, writeFixture, type FakeEnvironment } from './helpers';

afterEach(cleanupEnvs);

/** Calls as `[binary name, ...args]` so assertions do not depend on the fake bin directory. */
const calls = (env: FakeEnvironment): string[][] => env.calls.map(([bin, ...rest]) => [basename(bin), ...rest]);

describe('Claude Code through its own CLI', () => {
  it('adds with `claude mcp add --scope user hesman -- <command> <args>` and edits no file itself', () => {
    const env = makeEnv({ onPath: ['claude'] });
    const client = getClient('claude-code', env);

    const result = client.write({ command: 'npx', args: ['-y', 'hesman-mcp@1'] });

    expect(result.status).toBe('added');
    expect(result.via).toBe('cli');
    expect(result.applied).toBe(true);
    expect(calls(env)).toEqual([['claude', 'mcp', 'add', '--scope', 'user', 'hesman', '--', 'npx', '-y', 'hesman-mcp@1']]);
    expect(env.calls[0][0]).toBe(env.findOnPath('claude'));
    expect(existsSync(client.configPath('user'))).toBe(false);
  });

  it('passes --scope project for the project scope', () => {
    const env = makeEnv({ onPath: ['claude'] });
    getClient('claude-code', env).write(serverEntry(), { scope: 'project' });
    expect(calls(env)).toEqual([['claude', 'mcp', 'add', '--scope', 'project', 'hesman', '--', 'hesman']]);
  });

  it('runs nothing when the entry is already there', () => {
    const env = makeEnv({ onPath: ['claude'] });
    const client = getClient('claude-code', env);
    writeFixture(client.configPath('user'), JSON.stringify({ mcpServers: { hesman: { type: 'stdio', command: 'hesman', args: [], env: {} } } }));

    expect(client.write(serverEntry()).status).toBe('unchanged');
    expect(env.calls).toEqual([]);
  });

  it('replaces a stale entry with remove followed by add', () => {
    const env = makeEnv({ onPath: ['claude'] });
    const client = getClient('claude-code', env);
    writeFixture(client.configPath('user'), JSON.stringify({ mcpServers: { hesman: { command: 'old', args: [] } } }));

    expect(client.write(serverEntry()).status).toBe('updated');
    expect(calls(env)).toEqual([
      ['claude', 'mcp', 'remove', 'hesman', '--scope', 'user'],
      ['claude', 'mcp', 'add', '--scope', 'user', 'hesman', '--', 'hesman'],
    ]);
  });

  it('dry run prints the command and runs nothing', () => {
    const env = makeEnv({ onPath: ['claude'] });

    const result = getClient('claude-code', env).write(serverEntry(), { dryRun: true });

    expect(result.via).toBe('cli');
    expect(result.applied).toBe(false);
    expect(result.preview).toContain('claude mcp add --scope user hesman -- hesman');
    expect(env.calls).toEqual([]);
  });

  it('falls back to editing the file when the CLI fails, and says so', () => {
    const env = makeEnv({ onPath: ['claude'], onRun: () => ({ status: 1, stderr: 'boom' }) });
    const client = getClient('claude-code', env);

    const result = client.write(serverEntry());

    expect(result.via).toBe('file');
    expect(result.notes.join('\n')).toMatch(/claude mcp add.*failed.*boom/s);
    expect(JSON.parse(readFileSync(client.configPath('user'), 'utf-8')).mcpServers.hesman).toEqual({
      type: 'stdio', command: 'hesman', args: [],
    });
  });

  it('removes with `claude mcp remove hesman --scope user`', () => {
    const env = makeEnv({ onPath: ['claude'] });
    const client = getClient('claude-code', env);
    const before = JSON.stringify({ mcpServers: { hesman: { command: 'hesman', args: [] } } });
    writeFixture(client.configPath('user'), before);

    const result = client.remove();

    expect(result.status).toBe('removed');
    expect(result.via).toBe('cli');
    expect(calls(env)).toEqual([['claude', 'mcp', 'remove', 'hesman', '--scope', 'user']]);
    expect(readFileSync(client.configPath('user'), 'utf-8')).toBe(before);
  });

  it('remove runs nothing when there is no entry', () => {
    const env = makeEnv({ onPath: ['claude'] });
    expect(getClient('claude-code', env).remove().status).toBe('absent');
    expect(env.calls).toEqual([]);
  });

  it('on Windows, skips the CLI when an argument needs shell quoting', () => {
    const env = makeEnv({ platform: 'win32', onPath: ['claude'] });
    const client = getClient('claude-code', env);

    const result = client.write({ command: 'C:\\Program Files\\nodejs\\node.exe', args: [] });

    expect(result.via).toBe('file');
    expect(env.calls).toEqual([]);
  });
});

describe('Codex through its own CLI', () => {
  it('adds with `codex mcp add hesman -- <command> <args>`', () => {
    const env = makeEnv({ onPath: ['codex'] });
    const client = getClient('codex', env);

    const result = client.write({ command: 'npx', args: ['-y', 'hesman-mcp@1'] });

    expect(result.via).toBe('cli');
    expect(calls(env)).toEqual([['codex', 'mcp', 'add', 'hesman', '--', 'npx', '-y', 'hesman-mcp@1']]);
    expect(existsSync(client.configPath('user'))).toBe(false);
  });

  it('removes with `codex mcp remove hesman`', () => {
    const env = makeEnv({ onPath: ['codex'] });
    const client = getClient('codex', env);
    writeFixture(client.configPath('user'), '[mcp_servers.hesman]\ncommand = "hesman"\nargs = []\n');

    expect(client.remove().via).toBe('cli');
    expect(calls(env)).toEqual([['codex', 'mcp', 'remove', 'hesman']]);
  });

  it('edits the file for the project scope, which the CLI cannot target', () => {
    const env = makeEnv({ onPath: ['codex'] });
    const result = getClient('codex', env).write(serverEntry(), { scope: 'project' });
    expect(result.via).toBe('file');
    expect(env.calls).toEqual([]);
  });

  it('falls back to editing config.toml when the CLI fails', () => {
    const env = makeEnv({ onPath: ['codex'], onRun: () => ({ status: 2, stderr: 'nope' }) });
    const client = getClient('codex', env);

    const result = client.write(serverEntry());

    expect(result.via).toBe('file');
    expect(readFileSync(client.configPath('user'), 'utf-8')).toBe('[mcp_servers.hesman]\ncommand = "hesman"\nargs = []\n');
  });
});
