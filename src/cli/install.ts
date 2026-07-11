import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

interface AgentConfig {
  name: string;
  configPath: string;
  isProjectLocal: boolean;
}

function getAgentConfig(agent: string, projectRoot: string, global: boolean, home: string): AgentConfig {
  switch (agent.toLowerCase()) {
    case 'claude': {
      // Platform-specific Claude Desktop config path
      let configDir: string;
      if (process.platform === 'darwin') {
        configDir = join(home, 'Library', 'Application Support', 'Claude');
      } else if (process.platform === 'win32') {
        configDir = join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude');
      } else {
        configDir = join(home, '.config', 'Claude');
      }
      return {
        name: 'claude',
        configPath: join(configDir, 'claude_desktop_config.json'),
        isProjectLocal: false,
      };
    }
    case 'cursor': {
      const configDir = join(home, '.cursor');
      return {
        name: 'cursor',
        configPath: join(configDir, 'mcp.json'),
        isProjectLocal: false,
      };
    }
    case 'vscode': {
      return {
        name: 'vscode',
        configPath: join(projectRoot, '.vscode', 'mcp.json'),
        isProjectLocal: true,
      };
    }
    default:
      throw new Error(`Unknown agent: ${agent}. Supported: claude, cursor, vscode`);
  }
}

export function installAgent(
  agent: string,
  projectRoot: string,
  global: boolean = false,
  home: string = homedir(),
): void {
  const agentConfig = getAgentConfig(agent, projectRoot, global, home);

  // Read existing config or start fresh
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(agentConfig.configPath)) {
    try {
      const raw = readFileSync(agentConfig.configPath, 'utf-8');
      config = JSON.parse(raw);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Invalid JSON in existing config at ${agentConfig.configPath}: ${err.message}`);
      }
      throw err;
    }
  }

  // Ensure mcpServers key exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Write hesman entry
  config.mcpServers['hesman'] = {
    command: 'hesman',
    args: [],
    cwd: projectRoot,
  };

  // Ensure parent directory exists
  const dir = dirname(agentConfig.configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(agentConfig.configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`Hesman installed to ${agentConfig.configPath}`);
}
