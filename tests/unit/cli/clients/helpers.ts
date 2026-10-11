import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ClientEnvironment, RunResult } from '../../../../src/cli/clients/types';

export const PLATFORMS = ['darwin', 'linux', 'win32'] as const;
export type TestPlatform = (typeof PLATFORMS)[number];

export interface FakeEnvironment extends ClientEnvironment {
  /** Every command the code under test tried to run, as argv. */
  calls: string[][];
}

export interface FakeEnvironmentOptions {
  platform?: NodeJS.Platform;
  /** Names of client CLIs that are "installed". Nothing real is ever executed. */
  onPath?: string[];
  env?: Record<string, string | undefined>;
  /** Result of a fake command; defaults to success. */
  onRun?: (argv: string[], env: FakeEnvironment) => Partial<RunResult> | void;
}

const created: string[] = [];

/**
 * A fully isolated environment: a temp home, a temp project as working directory, a fake PATH
 * lookup and a recording command runner. Tests never see the real home directory or real CLIs.
 */
export function makeEnv(options: FakeEnvironmentOptions = {}): FakeEnvironment {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-clients-test-')));
  created.push(base);
  const home = join(base, 'home');
  const cwd = join(base, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const platform = options.platform ?? 'linux';
  const calls: string[][] = [];
  const env: FakeEnvironment = {
    home,
    cwd,
    platform,
    env: {
      ...(platform === 'win32' ? { APPDATA: join(home, 'AppData', 'Roaming') } : {}),
      ...options.env,
    },
    calls,
    findOnPath: (name) => (options.onPath?.includes(name) ? join(base, 'bin', name) : undefined),
    run: (command, args) => {
      const argv = [command, ...args];
      calls.push(argv);
      return { status: 0, stdout: '', stderr: '', ...(options.onRun?.(argv, env) ?? {}) };
    },
  };
  return env;
}

export function cleanupEnvs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function writeFixture(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
