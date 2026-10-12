import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RotatingFile, readRotatedLines, rotatedPath } from '../../../src/diagnostics/rotating-file';

describe('RotatingFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-rotating-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates missing parent directories and appends one line per call', () => {
    const path = join(dir, 'nested', 'deep', 'out.log');
    const file = new RotatingFile(path, { maxBytes: 1024 });
    file.append('first');
    file.append('second');
    file.close();

    expect(readFileSync(path, 'utf-8')).toBe('first\nsecond\n');
  });

  it('moves a full file to one rotated file and starts a new one', () => {
    const path = join(dir, 'out.log');
    const file = new RotatingFile(path, { maxBytes: 100 });
    const line = 'x'.repeat(39); // 40 bytes with the newline
    file.append(line);
    file.append(line);
    file.append(line); // would make 120 bytes: rotates first
    file.close();

    expect(readFileSync(rotatedPath(path), 'utf-8')).toBe(`${line}\n${line}\n`);
    expect(readFileSync(path, 'utf-8')).toBe(`${line}\n`);
  });

  it('keeps at most two files, each within the size cap', () => {
    const path = join(dir, 'out.log');
    const file = new RotatingFile(path, { maxBytes: 200 });
    for (let i = 0; i < 500; i++) file.append(`line-${String(i).padStart(4, '0')}`);
    file.close();

    expect(statSync(path).size).toBeLessThanOrEqual(200);
    expect(statSync(rotatedPath(path)).size).toBeLessThanOrEqual(200);
    expect(existsSync(`${path}.2`)).toBe(false);
    // The newest line survives; the oldest was dropped with an earlier rotation.
    const lines = readRotatedLines(path);
    expect(lines[lines.length - 1]).toBe('line-0499');
    expect(lines).not.toContain('line-0000');
  });

  it('continues an existing file instead of truncating it', () => {
    const path = join(dir, 'out.log');
    writeFileSync(path, 'old\n');
    const file = new RotatingFile(path, { maxBytes: 1024 });
    file.append('new');
    file.close();

    expect(readFileSync(path, 'utf-8')).toBe('old\nnew\n');
  });

  it('never throws when the file cannot be written', () => {
    // The parent "directory" is a regular file, so opening must fail.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, '');
    const file = new RotatingFile(join(blocker, 'out.log'), { maxBytes: 1024 });

    expect(() => file.append('lost')).not.toThrow();
    expect(() => file.close()).not.toThrow();
  });

  it('follows the file when another writer rotated it', () => {
    const path = join(dir, 'out.log');
    const a = new RotatingFile(path, { maxBytes: 100 });
    const b = new RotatingFile(path, { maxBytes: 100 });
    const line = 'y'.repeat(39);
    a.append(line);
    b.append(line);
    b.append(line); // b rotates; a still holds the rotated file
    a.append(line); // 80 bytes now in the current file
    a.append(line); // a must rotate or follow, never grow a file past the cap
    a.close();
    b.close();

    expect(statSync(path).size).toBeLessThanOrEqual(100);
    expect(statSync(rotatedPath(path)).size).toBeLessThanOrEqual(100);
  });
});

describe('readRotatedLines', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-rotating-read-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the rotated lines before the current ones, oldest first', () => {
    const path = join(dir, 'out.log');
    writeFileSync(rotatedPath(path), 'a\nb\n');
    writeFileSync(path, 'c\n\nd\n');

    expect(readRotatedLines(path)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns nothing when no file exists', () => {
    expect(readRotatedLines(join(dir, 'missing.log'))).toEqual([]);
  });

  it('returns nothing when the path is a directory', () => {
    const path = join(dir, 'a-directory');
    mkdirSync(path);
    expect(readRotatedLines(path)).toEqual([]);
  });
});
