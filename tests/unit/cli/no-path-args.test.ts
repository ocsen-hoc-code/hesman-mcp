import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { splitArgs } from '../../../src/cli/args';
import { SqliteStore } from '../../../src/stores/sqlite';

describe('splitArgs', () => {
  it('separates positionals from boolean flags in any order', () => {
    expect(splitArgs(['--force', 'some/path', '--dry-run'])).toEqual({
      positionals: ['some/path'],
      flags: new Set(['--force', '--dry-run']),
      values: new Map(),
    });
  });

  it('returns no positionals when only flags are given', () => {
    const parsed = splitArgs(['--json']);
    expect(parsed.positionals).toEqual([]);
    expect(parsed.flags.has('--json')).toBe(true);
  });

  it('consumes the value of a value-taking flag so it is not a positional', () => {
    const parsed = splitArgs(['--agent', 'cursor', 'proj', '--global'], ['--agent']);
    expect(parsed.positionals).toEqual(['proj']);
    expect(parsed.values.get('--agent')).toBe('cursor');
    expect(parsed.flags.has('--global')).toBe(true);
  });

  it('does not take another flag as the value of a value-taking flag', () => {
    const parsed = splitArgs(['--agent', '--global'], ['--agent']);
    expect(parsed.values.has('--agent')).toBe(false);
    expect(parsed.flags.has('--global')).toBe(true);
  });

  it('accepts --flag=value syntax for value-taking flags', () => {
    const parsed = splitArgs(['--agent=claude'], ['--agent']);
    expect(parsed.values.get('--agent')).toBe('claude');
    expect(parsed.positionals).toEqual([]);
  });
});

describe('CLI commands without a path argument use the current directory', () => {
  let project: string;
  let originalCwd: string;
  let logs: string[];

  function output(): string {
    return logs.join('\n');
  }

  function makeDataDir(): string {
    const dataDir = join(project, '.hesman');
    const store = new SqliteStore(dataDir);
    store.open();
    store.close();
    return dataDir;
  }

  beforeEach(() => {
    originalCwd = process.cwd();
    // realpath: macOS tmpdir is a symlink (/var -> /private/var) and process.cwd() reports the real path.
    project = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-no-path-args-')));
    process.chdir(project);
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    process.exitCode = undefined;
    rmSync(project, { recursive: true, force: true });
  });

  it('clean --force deletes ./.hesman, not ./--force/.hesman', async () => {
    const dataDir = makeDataDir();
    const { runClean } = await import('../../../src/cli/commands');

    await runClean(['--force']);

    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(join(project, '--force'))).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('clean --dry-run reports ./.hesman and deletes nothing', async () => {
    const dataDir = makeDataDir();
    const { runClean } = await import('../../../src/cli/commands');

    await runClean(['--dry-run']);

    expect(existsSync(dataDir)).toBe(true);
    expect(output()).toContain(`Would delete: ${dataDir}`);
  });

  it('status reports the current directory as the project', async () => {
    const { runStatus } = await import('../../../src/cli/commands');

    await runStatus([]);

    expect(output()).toContain(`Project: ${project}`);
    expect(output()).toContain(`Data directory: ${join(project, '.hesman')}`);
  });

  it('diag --json reads the store in ./.hesman', async () => {
    makeDataDir();
    const { runDiag } = await import('../../../src/cli/commands');

    await runDiag(['--json']);

    const parsed = JSON.parse(output());
    expect(parsed.store).not.toBeNull();
    expect(parsed.store.totalFiles).toBe(0);
    expect(existsSync(join(project, '--json'))).toBe(false);
  });

  it('index --data-dir <dir> does not treat the flag value as the project path', async () => {
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'src', 'a.ts'), 'export function hello(): number { return 1; }\n');
    const { runIndex } = await import('../../../src/cli/commands');

    await runIndex(['--data-dir', 'custom-data']);

    expect(output()).toContain(`Indexing project at ${project}...`);
  });
});
