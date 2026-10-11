import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allClients, getClient } from '../../../../src/cli/clients/index';
import { runInstall, runRemove, runSetup, type CliIo } from '../../../../src/cli/clients/setup';
import { cleanupEnvs, makeEnv, writeFixture, type FakeEnvironment, type FakeEnvironmentOptions } from './helpers';

afterEach(cleanupEnvs);

interface Harness {
  env: FakeEnvironment;
  io: CliIo;
  lines: string[];
  text: () => string;
  questions: string[];
}

function harness(options: FakeEnvironmentOptions & { isTTY?: boolean; answers?: string[] } = {}): Harness {
  const env = makeEnv(options);
  const lines: string[] = [];
  const questions: string[] = [];
  const answers = [...(options.answers ?? [])];
  const io: CliIo = {
    env,
    out: (line) => lines.push(line),
    isTTY: options.isTTY ?? false,
    ask: async (question) => {
      questions.push(question);
      const answer = answers.shift();
      if (answer === undefined) throw new Error('unexpected prompt');
      return answer;
    },
  };
  return { env, io, lines, questions, text: () => lines.join('\n') };
}

const ALL_IDS = ['claude-code', 'claude-desktop', 'codex', 'cursor', 'antigravity', 'vscode', 'gemini-cli', 'windsurf'] as const;

function configured(env: FakeEnvironment): string[] {
  return allClients(env).filter((c) => c.read('user') !== undefined).map((c) => c.id);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

describe('hesman setup', () => {
  it('--dry-run --all prints the exact change for each of the 8 clients and writes nothing', async () => {
    const h = harness();

    const code = await runSetup(['--dry-run', '--all'], h.io);

    expect(code).toBe(0);
    for (const client of allClients(h.env)) {
      expect(h.text()).toContain(client.label);
      expect(h.text()).toContain(client.configPath('user'));
    }
    expect(h.text()).toContain('"servers"');
    expect(h.text()).toContain('"type": "stdio"');
    expect(h.text()).toContain('[mcp_servers.hesman]');
    expect(h.text()).toContain('${workspaceFolder}');
    expect(h.text()).toContain(`"${h.env.cwd}"`);
    expect(h.text()).toMatch(/dry run/i);
    expect(filesUnder(h.env.home)).toEqual([]);
    expect(filesUnder(h.env.cwd)).toEqual([]);
    expect(h.env.calls).toEqual([]);
  });

  it('--all configures all 8 clients', async () => {
    const h = harness();
    expect(await runSetup(['--all'], h.io)).toBe(0);
    expect(configured(h.env)).toEqual([...ALL_IDS]);
  });

  it('--yes configures only the detected clients without asking', async () => {
    const h = harness({ isTTY: true });
    writeFixture(join(h.env.home, '.cursor', 'marker'), '');
    writeFixture(join(h.env.home, '.codex', 'marker'), '');

    expect(await runSetup(['--yes'], h.io)).toBe(0);

    expect(configured(h.env)).toEqual(['codex', 'cursor']);
    expect(h.questions).toEqual([]);
  });

  it('--yes with nothing detected changes nothing and explains how to choose clients', async () => {
    const h = harness();
    expect(await runSetup(['--yes'], h.io)).toBe(1);
    expect(h.text()).toMatch(/no supported client was detected/i);
    expect(h.text()).toContain('--client');
    expect(configured(h.env)).toEqual([]);
  });

  it.each([
    [['--client', 'cursor', 'vscode']],
    [['--client', 'cursor', '--client', 'vscode']],
    [['--client=cursor,vscode']],
    [['--client', 'Cursor,VSCode', '--yes']],
  ])('accepts several clients as %j', async (args) => {
    const h = harness();
    expect(await runSetup(args, h.io)).toBe(0);
    expect(configured(h.env)).toEqual(['cursor', 'vscode']);
  });

  it('rejects an unknown client, lists the supported ones and writes nothing', async () => {
    const h = harness();
    expect(await runSetup(['--client', 'cursor', 'emacs'], h.io)).toBe(1);
    expect(h.text()).toMatch(/unknown client.*emacs/i);
    for (const id of ALL_IDS) expect(h.text()).toContain(id);
    expect(configured(h.env)).toEqual([]);
  });

  it('asks which Claude is meant for the ambiguous name "claude"', async () => {
    const h = harness();
    expect(await runSetup(['--client', 'claude'], h.io)).toBe(1);
    expect(h.text()).toMatch(/claude-code.*claude-desktop/s);
  });

  it('without a terminal and without a choice it prints what it found and how to proceed, and never prompts', async () => {
    const h = harness({ isTTY: false });
    writeFixture(join(h.env.home, '.cursor', 'marker'), '');

    const code = await runSetup([], h.io);

    expect(code).toBe(1);
    expect(h.questions).toEqual([]);
    expect(h.text()).toMatch(/\[x\] .*Cursor/);
    expect(h.text()).toMatch(/\[ \] .*Windsurf/);
    expect(h.text()).toContain('hesman setup --yes');
    expect(configured(h.env)).toEqual([]);
  });

  it('on a terminal it shows a checklist with detected clients pre-selected and applies it on Enter', async () => {
    const h = harness({ isTTY: true, answers: [''] });
    writeFixture(join(h.env.home, '.cursor', 'marker'), '');

    expect(await runSetup([], h.io)).toBe(0);

    expect(h.text()).toMatch(/\[x\] +4\. Cursor/);
    expect(h.text()).toMatch(/\[ \] +1\. Claude Code/);
    expect(h.questions).toHaveLength(1);
    expect(configured(h.env)).toEqual(['cursor']);
  });

  it('the checklist toggles by number, then applies', async () => {
    const h = harness({ isTTY: true, answers: ['4 6', 'x', ''] });
    writeFixture(join(h.env.home, '.cursor', 'marker'), '');

    expect(await runSetup([], h.io)).toBe(0);

    expect(h.text()).toMatch(/did not understand "x"/i);
    expect(configured(h.env)).toEqual(['vscode']);
  });

  it('the checklist can be cancelled', async () => {
    const h = harness({ isTTY: true, answers: ['q'] });
    writeFixture(join(h.env.home, '.cursor', 'marker'), '');

    expect(await runSetup([], h.io)).toBe(1);
    expect(configured(h.env)).toEqual([]);
  });

  it('--dry-run without a choice previews the detected clients and never prompts', async () => {
    const h = harness({ isTTY: true });
    writeFixture(join(h.env.home, '.cursor', 'marker'), '');

    expect(await runSetup(['--dry-run'], h.io)).toBe(0);

    expect(h.text()).toContain('Cursor');
    expect(h.text()).not.toContain('Windsurf');
    expect(h.questions).toEqual([]);
    expect(configured(h.env)).toEqual([]);
  });

  it('--scope project writes project files and skips clients that have no project scope', async () => {
    const h = harness();

    expect(await runSetup(['--all', '--scope', 'project'], h.io)).toBe(0);

    expect(existsSync(join(h.env.cwd, '.vscode', 'mcp.json'))).toBe(true);
    expect(existsSync(join(h.env.cwd, '.cursor', 'mcp.json'))).toBe(true);
    expect(existsSync(join(h.env.cwd, '.mcp.json'))).toBe(true);
    expect(h.text()).toMatch(/Windsurf.*skipped.*no project scope/is);
    expect(filesUnder(h.env.home)).toEqual([]);
  });

  it('rejects an invalid --scope', async () => {
    const h = harness();
    expect(await runSetup(['--all', '--scope', 'global'], h.io)).toBe(1);
    expect(h.text()).toMatch(/--scope must be "user" or "project"/);
    expect(configured(h.env)).toEqual([]);
  });

  it('--project-root pins the project for Claude Desktop and says so', async () => {
    const h = harness();
    const project = join(h.env.home, 'work', 'app');

    expect(await runSetup(['--client', 'claude-desktop', '--project-root', project], h.io)).toBe(0);

    expect(getClient('claude-desktop', h.env).read()?.args).toEqual(['--project-root', project]);
    expect(h.text()).toContain(`always use ${project}`);
  });

  it('a failing client does not stop the others and the exit code is 1', async () => {
    const h = harness();
    const cursorPath = getClient('cursor', h.env).configPath('user');
    writeFixture(cursorPath, '{ broken');

    expect(await runSetup(['--client', 'cursor', 'vscode'], h.io)).toBe(1);

    expect(h.text()).toMatch(/Cursor.*failed.*Invalid JSON/s);
    expect(readFileSync(cursorPath, 'utf-8')).toBe('{ broken');
    expect(configured(h.env)).toEqual(['vscode']);
  });

  it('reports the backup it made and tells the user to restart the client', async () => {
    const h = harness();
    const path = getClient('cursor', h.env).configPath('user');
    writeFixture(path, '{}\n');

    await runSetup(['--client', 'cursor'], h.io);

    expect(h.text()).toContain(`${path}.hesman.bak`);
    expect(h.text()).toMatch(/restart/i);
  });

  it('prefers the client CLIs when they are on PATH', async () => {
    const h = harness({ onPath: ['claude', 'codex'] });

    expect(await runSetup(['--client', 'claude-code', 'codex'], h.io)).toBe(0);

    expect(h.env.calls.map((c) => c.slice(1).join(' '))).toEqual([
      'mcp add --scope user hesman -- hesman',
      'mcp add hesman -- hesman',
    ]);
  });
});

describe('hesman remove', () => {
  const ORIGINALS: Record<(typeof ALL_IDS)[number], string> = {
    'claude-code': '{\n  "numStartups": 3,\n  "mcpServers": {}\n}\n',
    'claude-desktop': '{"mcpServers":{"alpha":{"command":"alpha"}}}',
    codex: '# my codex\nmodel = "gpt-5"\n\n[mcp_servers.alpha]\ncommand = "alpha"\n',
    cursor: '{\n\t"mcpServers": {\n\t\t"alpha": { "command": "alpha" }\n\t}\n}\n',
    antigravity: '{}\n',
    vscode: '{\n    "servers": {\n        "alpha": { "type": "stdio", "command": "alpha" }\n    },\n    "inputs": []\n}\n',
    'gemini-cli': '{\n  "theme": "Default"\n}\n',
    windsurf: '',
  };

  it('setup then remove leaves every client config byte-identical', async () => {
    const h = harness();
    for (const client of allClients(h.env)) writeFixture(client.configPath('user'), ORIGINALS[client.id]);

    expect(await runSetup(['--all'], h.io)).toBe(0);
    expect(configured(h.env)).toEqual([...ALL_IDS]);
    expect(await runRemove([], h.io)).toBe(0);

    for (const client of allClients(h.env)) {
      expect(readFileSync(client.configPath('user'), 'utf-8'), client.id).toBe(ORIGINALS[client.id]);
    }
  });

  it('setup then remove on a clean home leaves no config file behind', async () => {
    const h = harness();

    await runSetup(['--all'], h.io);
    expect(await runRemove([], h.io)).toBe(0);

    expect(filesUnder(h.env.home)).toEqual([]);
  });

  it('without --client it removes Hesman from every client that has it', async () => {
    const h = harness();
    await runSetup(['--client', 'cursor', 'gemini-cli'], h.io);

    expect(await runRemove([], h.io)).toBe(0);

    expect(configured(h.env)).toEqual([]);
    expect(h.text()).toMatch(/Cursor.*removed/s);
  });

  it('--client limits the removal', async () => {
    const h = harness();
    await runSetup(['--client', 'cursor', 'gemini-cli'], h.io);

    expect(await runRemove(['--client', 'cursor'], h.io)).toBe(0);

    expect(configured(h.env)).toEqual(['gemini-cli']);
  });

  it('--dry-run removes nothing', async () => {
    const h = harness();
    await runSetup(['--client', 'cursor'], h.io);

    expect(await runRemove(['--dry-run'], h.io)).toBe(0);

    expect(configured(h.env)).toEqual(['cursor']);
    expect(h.text()).toMatch(/dry run/i);
  });

  it('says so when Hesman is configured nowhere', async () => {
    const h = harness();
    expect(await runRemove([], h.io)).toBe(0);
    expect(h.text()).toMatch(/not configured in any client/i);
  });

  it('--scope project removes the project entry', async () => {
    const h = harness();
    await runSetup(['--client', 'vscode', '--scope', 'project'], h.io);

    expect(await runRemove(['--scope', 'project'], h.io)).toBe(0);

    expect(existsSync(join(h.env.cwd, '.vscode', 'mcp.json'))).toBe(false);
  });
});

describe('hesman install (deprecated alias)', () => {
  it('--agent X behaves like setup --client X --yes and prints a deprecation note', async () => {
    const h = harness({ isTTY: true });

    expect(await runInstall(['--agent', 'cursor'], h.io)).toBe(0);

    expect(configured(h.env)).toEqual(['cursor']);
    expect(h.text()).toMatch(/deprecated.*hesman setup --client cursor/s);
    expect(h.questions).toEqual([]);
  });

  it('keeps "claude" meaning Claude Desktop, as it did before', async () => {
    const h = harness();
    expect(await runInstall(['--agent', 'claude'], h.io)).toBe(0);
    expect(configured(h.env)).toEqual(['claude-desktop']);
  });

  it('accepts and ignores --global with a note', async () => {
    const h = harness();

    expect(await runInstall(['--agent', 'vscode', '--global'], h.io)).toBe(0);

    expect(h.text()).toMatch(/--global.*ignored/s);
    expect(configured(h.env)).toEqual(['vscode']);
  });

  it('fixes the old VS Code output: "servers" + type "stdio", no "mcpServers", no cwd', async () => {
    const h = harness();

    await runInstall(['--agent', 'vscode'], h.io);

    const written = JSON.parse(readFileSync(getClient('vscode', h.env).configPath('user'), 'utf-8'));
    expect(written).toEqual({ servers: { hesman: { type: 'stdio', command: 'hesman', args: [] } } });
  });

  it('prints usage and fails without --agent', async () => {
    const h = harness();
    expect(await runInstall(['--global'], h.io)).toBe(1);
    expect(h.text()).toContain('hesman setup');
    expect(configured(h.env)).toEqual([]);
  });
});
