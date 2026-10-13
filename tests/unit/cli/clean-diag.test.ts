import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { tmpdir } from 'node:os';

// Lets tests point the home directory at a temp dir so the home-dir guard
// can be exercised without ever touching the real home directory.
const fakeHome: { dir: string | null } = { dir: null };
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome.dir ?? actual.homedir() };
});

const TEST_DIR = join(tmpdir(), 'hesman-clean-diag-test');
const TEST_DATA = join(TEST_DIR, '.hesman');

describe('clean command', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DATA, { recursive: true });
    writeFileSync(join(TEST_DATA, 'symbols.db'), 'test data');
    // Create subdirectory with files
    mkdirSync(join(TEST_DATA, 'zvec'), { recursive: true });
    writeFileSync(join(TEST_DATA, 'zvec', 'index.bin'), 'binary data');
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('runClean --dry-run does not delete', async () => {
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([TEST_DIR, '--dry-run']);
    expect(existsSync(TEST_DATA)).toBe(true);
  });

  it('runClean --force deletes .hesman', async () => {
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([TEST_DIR, '--force']);
    expect(existsSync(TEST_DATA)).toBe(false);
  });

  it('runClean without --force shows prompt but does not delete', async () => {
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([TEST_DIR]);
    // Without --force, it should warn and not delete
    expect(existsSync(TEST_DATA)).toBe(true);
  });

  it('runClean with nonexistent directory shows nothing to clean', async () => {
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([join(TEST_DIR, 'nonexistent'), '--force']);
    // Should not throw
  });
});

describe('clean command guard rails', () => {
  const GUARD_DIR = join(tmpdir(), 'hesman-clean-guard-test');
  const PROJECT = join(GUARD_DIR, 'project');
  let errors: string[];

  function output(): string {
    return errors.join('\n');
  }

  beforeEach(() => {
    if (existsSync(GUARD_DIR)) rmSync(GUARD_DIR, { recursive: true });
    mkdirSync(PROJECT, { recursive: true });
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fakeHome.dir = null;
    process.exitCode = undefined;
    if (existsSync(GUARD_DIR)) rmSync(GUARD_DIR, { recursive: true });
  });

  it('refuses when dataDir equals the project root', async () => {
    writeFileSync(join(PROJECT, 'symbols.db'), 'db');
    writeFileSync(join(PROJECT, 'keep.ts'), 'source');
    vi.stubEnv('HESMAN_DATA_DIR', '.');
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([PROJECT, '--force']);
    expect(existsSync(join(PROJECT, 'keep.ts'))).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(output()).toMatch(/equals the project root/);
  });

  it('refuses when dataDir is an ancestor of the project root', async () => {
    writeFileSync(join(GUARD_DIR, 'symbols.db'), 'db');
    vi.stubEnv('HESMAN_DATA_DIR', '..');
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([PROJECT, '--force']);
    expect(existsSync(PROJECT)).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(output()).toMatch(/ancestor of the project root/);
  });

  it('refuses when dataDir is the home directory', async () => {
    const home = join(GUARD_DIR, 'home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'symbols.db'), 'db');
    fakeHome.dir = home;
    vi.stubEnv('HESMAN_DATA_DIR', home);
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([PROJECT, '--force']);
    expect(existsSync(home)).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(output()).toMatch(/home directory/);
  });

  it('refuses when dataDir is a filesystem root (reported by --dry-run)', async () => {
    // --dry-run never deletes, so this stays safe even if the guard regresses.
    vi.stubEnv('HESMAN_DATA_DIR', parse(PROJECT).root);
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([PROJECT, '--dry-run']);
    expect(process.exitCode).toBe(1);
    expect(output()).toMatch(/filesystem root/);
  });

  it('refuses when dataDir does not contain the symbols.db marker', async () => {
    const dataDir = join(PROJECT, 'not-hesman');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'important.txt'), 'user data');
    vi.stubEnv('HESMAN_DATA_DIR', 'not-hesman');
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([PROJECT, '--force']);
    expect(existsSync(join(dataDir, 'important.txt'))).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(output()).toMatch(/symbols\.db/);
  });

  it('--dry-run reports the refusal reason', async () => {
    const dataDir = join(PROJECT, 'not-hesman');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'important.txt'), 'user data');
    vi.stubEnv('HESMAN_DATA_DIR', 'not-hesman');
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([PROJECT, '--dry-run']);
    expect(process.exitCode).toBe(1);
    expect(output()).toMatch(/symbols\.db/);
  });

  it('deletes a valid Hesman data directory with --force', async () => {
    const dataDir = join(PROJECT, '.hesman');
    mkdirSync(join(dataDir, 'zvec'), { recursive: true });
    writeFileSync(join(dataDir, 'symbols.db'), 'db');
    writeFileSync(join(dataDir, 'zvec', 'index.bin'), 'bin');
    const { runClean } = await import('../../../src/cli/commands');
    await runClean([PROJECT, '--force']);
    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(PROJECT)).toBe(true);
    expect(process.exitCode).toBeUndefined();
    expect(output()).toBe('');
  });
});

describe('diag command', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DATA, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('runDiag outputs JSON when --json flag is set', async () => {
    const { runDiag } = await import('../../../src/cli/commands');

    // Capture stdout
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    try {
      await runDiag([TEST_DIR, '--json']);
    } finally {
      console.log = origLog;
    }

    const output = logs.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.version).toBeDefined();
    expect(parsed.node).toBeDefined();
    expect(parsed.platform).toBeDefined();
    expect(parsed.memory).toBeDefined();
    expect(parsed.memory.heapUsedMB).toBeGreaterThan(0);
  });

  it('runDiag outputs human-readable format by default', async () => {
    const { runDiag } = await import('../../../src/cli/commands');

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    try {
      await runDiag([TEST_DIR]);
    } finally {
      console.log = origLog;
    }

    const output = logs.join('\n');
    expect(output).toContain('hesman');
    expect(output).toContain('Runtime');
    expect(output).toContain('Memory');
  });
});
