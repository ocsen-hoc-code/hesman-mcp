import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Unique per test so concurrent runs (parallel worktrees, CI retries) never share a directory.
function makeTestDir(): string {
  return mkdtempSync(join(tmpdir(), 'hesman-cli-e2e-'));
}

describe('CLI E2E', () => {
  it('hesman --version prints version', () => {
    const output = execSync('npx tsx src/index.ts --version', { encoding: 'utf-8' });
    expect(output).toContain('hesman v');
  });

  it('hesman --help shows usage', () => {
    const output = execSync('npx tsx src/index.ts --help', { encoding: 'utf-8' });
    expect(output).toContain('hesman');
    expect(output).toContain('install');
    expect(output).toContain('clean');
    expect(output).toContain('diag');
  });

  it('hesman diag --json outputs valid JSON', () => {
    const output = execSync('npx tsx src/index.ts diag tests/fixtures/ts-basic --json', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: { ...process.env, HESMAN_LOG_LEVEL: 'error' },
    });
    const parsed = JSON.parse(output);
    expect(parsed.version).toBeDefined();
    expect(parsed.memory).toBeDefined();
  });

  it('hesman clean --dry-run does not delete', () => {
    // Create temp data dir
    const TEST_DIR = makeTestDir();
    const dataDir = join(TEST_DIR, '.hesman');
    mkdirSync(dataDir, { recursive: true });

    try {
      execSync(`npx tsx src/index.ts clean "${TEST_DIR}" --dry-run`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      expect(existsSync(dataDir)).toBe(true);
    } finally {
      if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('hesman clean --force deletes .hesman', () => {
    const TEST_DIR = makeTestDir();
    const dataDir = join(TEST_DIR, '.hesman');
    mkdirSync(dataDir, { recursive: true });

    try {
      execSync(`npx tsx src/index.ts clean "${TEST_DIR}" --force`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    }
  });
});
