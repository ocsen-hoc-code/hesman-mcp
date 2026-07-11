import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
