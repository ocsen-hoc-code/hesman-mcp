import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TEST_HOME = '';

// We import install logic — it writes to paths we control via env var mocking
describe('install command', () => {
  beforeEach(() => {
    TEST_HOME = mkdtempSync(join(tmpdir(), 'hesman-install-test-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(TEST_HOME, { recursive: true, force: true });
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

  describe('safe writes (M0-11)', () => {
    function claudeConfigPath(): string {
      return join(makeClaudeConfigDir(), 'claude_desktop_config.json');
    }

    function tmpLeftovers(path: string): string[] {
      const dir = join(path, '..');
      return readdirSync(dir).filter((f) => f.includes('.tmp-'));
    }

    it('backs up the existing config to <config>.hesman.bak and reports the path', async () => {
      const configPath = claudeConfigPath();
      const original = JSON.stringify({ mcpServers: { 'other-server': { command: 'other' } } });
      writeFileSync(configPath, original);
      const { installAgent } = await import('../../../src/cli/install');

      const result = installAgent('claude', '/fake/project', false, TEST_HOME);

      const backupPath = `${configPath}.hesman.bak`;
      expect(result.status).toBe('installed');
      expect(result.backupPath).toBe(backupPath);
      expect(readFileSync(backupPath, 'utf-8')).toBe(original);
      const logged = vi.mocked(console.log).mock.calls.flat().join('\n');
      expect(logged).toContain(backupPath);
    });

    it('creates no backup when the config did not exist', async () => {
      const configPath = claudeConfigPath();
      const { installAgent } = await import('../../../src/cli/install');

      const result = installAgent('claude', '/fake/project', false, TEST_HOME);

      expect(result.backupPath).toBeUndefined();
      expect(existsSync(`${configPath}.hesman.bak`)).toBe(false);
    });

    it('preserves every other mcpServers entry and top-level key exactly', async () => {
      const configPath = claudeConfigPath();
      const others = {
        alpha: { command: 'alpha', args: ['--x'], env: { TOKEN: 'abc' } },
        beta: { url: 'http://localhost:1234/sse' },
      };
      writeFileSync(configPath, JSON.stringify({ globalShortcut: 'Ctrl+Space', mcpServers: others }));
      const { installAgent } = await import('../../../src/cli/install');

      installAgent('claude', '/fake/project', false, TEST_HOME);

      const written = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(written.globalShortcut).toBe('Ctrl+Space');
      expect(written.mcpServers.alpha).toEqual(others.alpha);
      expect(written.mcpServers.beta).toEqual(others.beta);
      expect(Object.keys(written.mcpServers).sort()).toEqual(['alpha', 'beta', 'hesman']);
    });

    it('second run with the same entry writes nothing and reports already installed', async () => {
      const configPath = claudeConfigPath();
      const { installAgent } = await import('../../../src/cli/install');
      installAgent('claude', '/fake/project', false, TEST_HOME);
      const firstContent = readFileSync(configPath, 'utf-8');
      const firstMtime = statSync(configPath).mtimeMs;
      vi.mocked(console.log).mockClear();

      const result = installAgent('claude', '/fake/project', false, TEST_HOME);

      expect(result.status).toBe('unchanged');
      expect(readFileSync(configPath, 'utf-8')).toBe(firstContent);
      expect(statSync(configPath).mtimeMs).toBe(firstMtime);
      expect(existsSync(`${configPath}.hesman.bak`)).toBe(false);
      const logged = vi.mocked(console.log).mock.calls.flat().join('\n');
      expect(logged).toMatch(/already installed/i);
    });

    it('treats an identical entry in differently formatted JSON as already installed', async () => {
      const configPath = claudeConfigPath();
      const compact = JSON.stringify({
        mcpServers: { hesman: { command: 'hesman', args: [], cwd: '/fake/project' } },
      });
      writeFileSync(configPath, compact);
      const { installAgent } = await import('../../../src/cli/install');

      const result = installAgent('claude', '/fake/project', false, TEST_HOME);

      expect(result.status).toBe('unchanged');
      expect(readFileSync(configPath, 'utf-8')).toBe(compact);
    });

    it('invalid JSON errors and leaves the file untouched with no backup or temp file', async () => {
      const configPath = claudeConfigPath();
      const broken = '{ "mcpServers": { oops ';
      writeFileSync(configPath, broken);
      const { installAgent } = await import('../../../src/cli/install');

      expect(() => installAgent('claude', '/fake/project', false, TEST_HOME)).toThrow(/Invalid JSON/);

      expect(readFileSync(configPath, 'utf-8')).toBe(broken);
      expect(existsSync(`${configPath}.hesman.bak`)).toBe(false);
      expect(tmpLeftovers(configPath)).toEqual([]);
    });

    it('leaves no .tmp-* file behind after a successful write', async () => {
      const configPath = claudeConfigPath();
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));
      const { installAgent } = await import('../../../src/cli/install');

      installAgent('claude', '/fake/project', false, TEST_HOME);

      expect(tmpLeftovers(configPath)).toEqual([]);
    });
  });
});
