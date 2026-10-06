import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { writeConfigAtomically } from './config-writer.js';

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

export interface InstallResult {
  configPath: string;
  /** 'installed' when the config was written, 'unchanged' when the hesman entry was already identical. */
  status: 'installed' | 'unchanged';
  backupPath: string | undefined;
}

export function installAgent(
  agent: string,
  projectRoot: string,
  global: boolean = false,
  home: string = homedir(),
): InstallResult {
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

  const entry = {
    command: 'hesman',
    args: [],
    cwd: projectRoot,
  };

  if (isDeepStrictEqual(config.mcpServers['hesman'], entry)) {
    console.log(`Hesman already installed in ${agentConfig.configPath}`);
    return { configPath: agentConfig.configPath, status: 'unchanged', backupPath: undefined };
  }

  // Write hesman entry
  config.mcpServers['hesman'] = entry;

  const { backupPath } = writeConfigAtomically(agentConfig.configPath, JSON.stringify(config, null, 2) + '\n');
  if (backupPath) {
    console.log(`Backed up previous config to ${backupPath}`);
  }
  console.log(`Hesman installed to ${agentConfig.configPath}`);
  return { configPath: agentConfig.configPath, status: 'installed', backupPath };
}
