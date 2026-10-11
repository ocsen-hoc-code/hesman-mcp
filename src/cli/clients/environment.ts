import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { ClientEnvironment } from './types.js';

const CLI_TIMEOUT_MS = 30_000;

function isExecutableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return undefined;
}

/** The real machine: the user's home, the process working directory, PATH and `spawnSync`. */
export function realEnvironment(): ClientEnvironment {
  const platform = process.platform;
  return {
    home: homedir(),
    cwd: process.cwd(),
    platform,
    env: process.env,
    findOnPath: (name) => findOnPath(name, process.env, platform),
    run: (command, args, options) => {
      const result = spawnSync(command, args, {
        cwd: options?.cwd,
        encoding: 'utf-8',
        timeout: CLI_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
        // npm-installed CLIs are `.cmd` shims on Windows, which only start through a shell.
        // Adapters skip the CLI there when an argument would need quoting.
        shell: platform === 'win32',
      });
      return {
        status: result.status ?? -1,
        stdout: result.stdout ?? '',
        stderr: result.stderr || result.error?.message || '',
      };
    },
  };
}

/** Per-user application config directory: `%APPDATA%`, `~/Library/Application Support` or XDG. */
export function appConfigDir(env: ClientEnvironment): string {
  if (env.platform === 'win32') return env.env.APPDATA || join(env.home, 'AppData', 'Roaming');
  if (env.platform === 'darwin') return join(env.home, 'Library', 'Application Support');
  return xdgConfigDir(env);
}

/** `$XDG_CONFIG_HOME`, or `~/.config`. */
export function xdgConfigDir(env: ClientEnvironment): string {
  return env.env.XDG_CONFIG_HOME || join(env.home, '.config');
}
