import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { serverEntry } from '../../../../src/cli/clients/entry';
import type { ClientEnvironment, Installation, RunResult, ServerEntry } from '../../../../src/cli/clients/types';

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
  /** Executables at a chosen absolute path (wins over `onPath`), e.g. `{ npx: '/usr/local/bin/npx' }`. */
  pathOf?: Record<string, string>;
  /** Symbolic links for the fake `realpath`: link path → target. Other paths resolve to themselves. */
  links?: Record<string, string>;
  /** Facts about the "running" Hesman; defaults to {@link FAKE_INSTALLATION}. */
  installation?: Partial<Installation>;
  env?: Record<string, string | undefined>;
  /** Result of a fake command; defaults to success. */
  onRun?: (argv: string[], env: FakeEnvironment) => Partial<RunResult> | void;
}

/** A Hesman that is neither on PATH nor in an npx cache, so `--command auto` means `absolute`. */
export const FAKE_INSTALLATION: Installation = {
  execPath: '/fake/node/bin/node',
  entryScript: '/fake/hesman-mcp/dist/index.js',
  version: '1.4.2',
};

/** The `--command global` entry; what most adapter tests write. */
export const globalEntry = (): ServerEntry => serverEntry('global', FAKE_INSTALLATION);

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
    installation: { ...FAKE_INSTALLATION, ...options.installation },
    findOnPath: (name) => options.pathOf?.[name] ?? (options.onPath?.includes(name) ? join(base, 'bin', name) : undefined),
    realpath: (path) => options.links?.[path] ?? path,
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
