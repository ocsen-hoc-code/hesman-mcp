import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientEnvironment, Installation } from './types.js';

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

/**
 * The Hesman this code belongs to. The package root is three levels above this file both in
 * `dist/cli/clients/` and in `src/cli/clients/`; the entry script is always the built one, because
 * that is what a client can start with plain `node`.
 */
function runningInstallation(): Installation {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { version: string };
  return { execPath: process.execPath, entryScript: join(root, 'dist', 'index.js'), version: pkg.version };
}

function realpathOrSame(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The real machine: the user's home, the process working directory, PATH and `spawnSync`. */
export function realEnvironment(): ClientEnvironment {
  const platform = process.platform;
  return {
    home: homedir(),
    cwd: process.cwd(),
    platform,
    env: process.env,
    installation: runningInstallation(),
    findOnPath: (name) => findOnPath(name, process.env, platform),
    realpath: realpathOrSame,
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
