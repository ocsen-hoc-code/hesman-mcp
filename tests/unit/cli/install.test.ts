import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_HOME = join(tmpdir(), 'hesman-install-test');

// We import install logic — it writes to paths we control via env var mocking
describe('install command', () => {
  beforeEach(() => {
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true });
  });

  function makeClaudeConfigDir(): string {
    const dir = join(TEST_HOME, 'Library', 'Application Support', 'Claude');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function makeCursorConfigDir(): string {
    const dir = join(TEST_HOME, '.cursor');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('installAgent creates new claude config when file does not exist', async () => {
    const configDir = makeClaudeConfigDir();
    const configPath = join(configDir, 'claude_desktop_config.json');
    const { installAgent } = await import('../../../src/cli/install');

    installAgent('claude', '/fake/project', false, TEST_HOME);

    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.hesman.command).toBe('hesman');
    expect(written.mcpServers.hesman.cwd).toBe('/fake/project');
  });

  it('installAgent merges hesman into existing config with other MCP servers', async () => {
    const configDir = makeClaudeConfigDir();
    const configPath = join(configDir, 'claude_desktop_config.json');
    writeFileSync(configPath, JSON.stringify({
      mcpServers: { 'other-server': { command: 'other', args: [] } },
    }));
    const { installAgent } = await import('../../../src/cli/install');

    installAgent('claude', '/fake/project', false, TEST_HOME);

    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers['other-server']).toBeDefined(); // preserved
    expect(written.mcpServers.hesman).toBeDefined();           // added
  });

  it('installAgent overwrites existing hesman entry', async () => {
    const configDir = makeClaudeConfigDir();
    const configPath = join(configDir, 'claude_desktop_config.json');
    writeFileSync(configPath, JSON.stringify({
      mcpServers: { hesman: { command: 'old-hesman', args: ['--old'] } },
    }));
    const { installAgent } = await import('../../../src/cli/install');

    installAgent('claude', '/new/project', false, TEST_HOME);

    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.hesman.command).toBe('hesman');
    expect(written.mcpServers.hesman.cwd).toBe('/new/project');
  });

  it('installAgent creates cursor mcp.json', async () => {
    const configDir = makeCursorConfigDir();
    const configPath = join(configDir, 'mcp.json');
    const { installAgent } = await import('../../../src/cli/install');

    installAgent('cursor', '/fake/project', false, TEST_HOME);

    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers.hesman).toBeDefined();
  });

  it('installAgent creates vscode mcp.json in project .vscode/', async () => {
    const projectDir = join(TEST_HOME, 'myproject');
    const { installAgent } = await import('../../../src/cli/install');

    installAgent('vscode', projectDir, false, TEST_HOME);

    const configPath = join(projectDir, '.vscode', 'mcp.json');
    expect(existsSync(configPath)).toBe(true);
  });

  it('installAgent throws for unknown agent', async () => {
    const { installAgent } = await import('../../../src/cli/install');
    expect(() => installAgent('unknown-agent', '/fake', false, TEST_HOME)).toThrow(/Unknown agent/);
  });
});
