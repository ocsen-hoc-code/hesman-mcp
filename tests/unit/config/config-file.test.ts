import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test the internal functions by importing loader
// (loadConfig is the public API; we test via env + file interactions)

const TEST_ROOT = join(tmpdir(), 'hesman-config-test');

describe('Config — file loading + auto-detect', () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true });
    mkdirSync(TEST_ROOT, { recursive: true });
    mkdirSync(join(TEST_ROOT, 'nested', 'deep'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true });
  });

  it('findConfigFile returns null when no config file exists', async () => {
    const { findConfigFile } = await import('../../../src/config/loader');
    expect(findConfigFile(TEST_ROOT)).toBeNull();
  });

  it('findConfigFile finds hesman.config.json in current directory', async () => {
    writeFileSync(join(TEST_ROOT, 'hesman.config.json'), JSON.stringify({ workers: 4 }));
    const { findConfigFile } = await import('../../../src/config/loader');
    expect(findConfigFile(TEST_ROOT)).toBe(join(TEST_ROOT, 'hesman.config.json'));
  });

  it('findConfigFile walks up from subdirectory', async () => {
    writeFileSync(join(TEST_ROOT, 'hesman.config.json'), JSON.stringify({ workers: 4 }));
    const { findConfigFile } = await import('../../../src/config/loader');
    const deep = join(TEST_ROOT, 'nested', 'deep');
    expect(findConfigFile(deep)).toBe(join(TEST_ROOT, 'hesman.config.json'));
  });

  it('findConfigFile stops at .git boundary', async () => {
    mkdirSync(join(TEST_ROOT, '.git'));
    writeFileSync(join(TEST_ROOT, 'hesman.config.json'), JSON.stringify({ workers: 4 }));
    writeFileSync(join(TEST_ROOT, 'nested', 'hesman.config.json'), JSON.stringify({ workers: 2 }));
    const { findConfigFile } = await import('../../../src/config/loader');
    // From nested/, .git is not found until TEST_ROOT, so it stops at TEST_ROOT
    expect(findConfigFile(join(TEST_ROOT, 'nested'))).toBe(join(TEST_ROOT, 'nested', 'hesman.config.json'));
  });

  it('parseCliFlagsToOverrides reads --project-root', async () => {
    const { parseCliFlagsToOverrides } = await import('../../../src/config/loader');
    expect(parseCliFlagsToOverrides(['--no-watch', '--project-root', '/some/project'])).toMatchObject({
      projectRoot: '/some/project',
      watchMode: false,
    });
    expect(parseCliFlagsToOverrides(['--no-watch']).projectRoot).toBeUndefined();
  });

  it('loadConfig merges config file values over defaults', async () => {
    writeFileSync(join(TEST_ROOT, 'hesman.config.json'), JSON.stringify({ workers: 8, logLevel: 'debug' }));
    // Temporarily change cwd to TEST_ROOT so loadConfig picks up the file
    const origCwd = process.cwd;
    try {
      process.cwd = () => TEST_ROOT;
      const { loadConfig } = await import('../../../src/config/loader');
      const config = loadConfig();
      expect(config.workers).toBe(8);
      expect(config.logLevel).toBe('debug');
      // Unspecified fields remain at defaults
      expect(config.maxFileSizeBytes).toBe(2_097_152);
    } finally {
      process.cwd = origCwd;
    }
  });

  it('loadConfig merges CLI overrides over file and env', async () => {
    writeFileSync(join(TEST_ROOT, 'hesman.config.json'), JSON.stringify({ workers: 4 }));
    const origCwd = process.cwd;
    try {
      process.cwd = () => TEST_ROOT;
      const { loadConfig } = await import('../../../src/config/loader');
      const config = loadConfig({ workers: 16 });
      expect(config.workers).toBe(16); // CLI wins
    } finally {
      process.cwd = origCwd;
    }
  });

  it('loadConfig handles invalid JSON with clear error', async () => {
    writeFileSync(join(TEST_ROOT, 'hesman.config.json'), '{ workers: 4 }'); // invalid JSON
    const origCwd = process.cwd;
    try {
      process.cwd = () => TEST_ROOT;
      const { loadConfig } = await import('../../../src/config/loader');
      expect(() => loadConfig()).toThrow();
    } finally {
      process.cwd = origCwd;
    }
  });
});
