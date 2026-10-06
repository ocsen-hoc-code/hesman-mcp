import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import { writeConfigAtomically, backupPathFor } from '../../../src/cli/config-writer';

describe('writeConfigAtomically', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-config-writer-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function leftoverTmpFiles(d: string): string[] {
    return readdirSync(d).filter((f) => f.includes('.tmp-'));
  }

  it('creates a new file (and parent dirs) without a backup', () => {
    const target = join(dir, 'nested', 'deep', 'mcp.json');

    const result = writeConfigAtomically(target, '{"a":1}\n');

    expect(result).toEqual({ written: true, backupPath: undefined });
    expect(readFileSync(target, 'utf-8')).toBe('{"a":1}\n');
    expect(existsSync(backupPathFor(target))).toBe(false);
    expect(leftoverTmpFiles(join(dir, 'nested', 'deep'))).toEqual([]);
  });

  it('backs up the existing file to <config>.hesman.bak before replacing it', () => {
    const target = join(dir, 'mcp.json');
    writeFileSync(target, 'original');

    const result = writeConfigAtomically(target, 'updated');

    expect(result.written).toBe(true);
    expect(result.backupPath).toBe(`${target}.hesman.bak`);
    expect(readFileSync(`${target}.hesman.bak`, 'utf-8')).toBe('original');
    expect(readFileSync(target, 'utf-8')).toBe('updated');
    expect(leftoverTmpFiles(dir)).toEqual([]);
  });

  it('overwrites an older backup', () => {
    const target = join(dir, 'mcp.json');
    writeFileSync(`${target}.hesman.bak`, 'stale backup');
    writeFileSync(target, 'current');

    writeConfigAtomically(target, 'next');

    expect(readFileSync(`${target}.hesman.bak`, 'utf-8')).toBe('current');
  });

  it('writes nothing when the content is already identical', () => {
    const target = join(dir, 'mcp.json');
    writeFileSync(target, 'same');

    const result = writeConfigAtomically(target, 'same');

    expect(result).toEqual({ written: false, backupPath: undefined });
    expect(existsSync(backupPathFor(target))).toBe(false);
  });

  it('leaves the original intact and removes the temp file when rename fails', () => {
    const target = join(dir, 'mcp.json');
    writeFileSync(target, 'original');
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('simulated rename failure');
    });

    expect(() => writeConfigAtomically(target, 'updated')).toThrow(/simulated rename failure/);

    expect(readFileSync(target, 'utf-8')).toBe('original');
    expect(leftoverTmpFiles(dir)).toEqual([]);
  });
});
