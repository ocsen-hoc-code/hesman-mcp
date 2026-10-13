import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OUT_DIR,
  PARSERS,
  sha256,
  verifyChecksum,
  hasValidFile,
  ensureParser,
} from '../../../scripts/download-parsers';
import { LANGUAGES } from '../../../src/parsers/languages';

const CONTENT = Buffer.from('fake wasm bytes');
const GOOD_HASH = createHash('sha256').update(CONTENT).digest('hex');
const BAD_HASH = '0'.repeat(64);

function fakeFetch(body: Buffer, status = 200) {
  return vi.fn(async () => new Response(body, { status }));
}

describe('download-parsers', () => {
  let dir: string;

  beforeEach(() => {
    // Include a space to mimic repo paths that contain spaces.
    dir = mkdtempSync(join(tmpdir(), 'hesman parsers '));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('pins a sha256 for every parser', () => {
    expect(PARSERS.length).toBeGreaterThan(0);
    for (const p of PARSERS) {
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.url).toMatch(/^https:\/\//);
    }
  });

  it('pins exactly the grammars the language registry needs, as GitHub release assets', () => {
    expect(PARSERS.map((p) => p.name).sort()).toEqual([...new Set(LANGUAGES.map((l) => l.grammar))].sort());
    for (const p of PARSERS) {
      expect(p.url).toMatch(new RegExp(`^https://github\\.com/[\\w.-]+/[\\w.-]+/releases/download/[\\w.-]+/${p.name}$`));
    }
  });

  it('matches the grammars committed in parsers/, so tests and installs work offline', () => {
    for (const p of PARSERS) {
      expect(hasValidFile(join(OUT_DIR, p.name), p.sha256), `${p.name} is missing or does not match its pinned sha256`).toBe(true);
    }
  });

  it('sha256 returns the hex digest', () => {
    expect(sha256(CONTENT)).toBe(GOOD_HASH);
  });

  describe('verifyChecksum', () => {
    it('accepts a matching hash', () => {
      expect(() => verifyChecksum(CONTENT, GOOD_HASH, 'x.wasm')).not.toThrow();
    });

    it('rejects a mismatching hash', () => {
      expect(() => verifyChecksum(CONTENT, BAD_HASH, 'x.wasm')).toThrow(/checksum mismatch/i);
    });
  });

  describe('hasValidFile', () => {
    it('returns false when the file is missing', () => {
      expect(hasValidFile(join(dir, 'missing.wasm'), GOOD_HASH)).toBe(false);
    });

    it('returns true when the file matches the hash', () => {
      const p = join(dir, 'ok.wasm');
      writeFileSync(p, CONTENT);
      expect(hasValidFile(p, GOOD_HASH)).toBe(true);
    });

    it('returns false when the file content differs', () => {
      const p = join(dir, 'bad.wasm');
      writeFileSync(p, CONTENT);
      expect(hasValidFile(p, BAD_HASH)).toBe(false);
    });
  });

  describe('ensureParser', () => {
    it('downloads and writes the file when the hash matches', async () => {
      const fetchFn = fakeFetch(CONTENT);
      const spec = { name: 'a.wasm', url: 'https://example.test/a.wasm', sha256: GOOD_HASH };
      const result = await ensureParser(spec, dir, fetchFn);
      expect(result).toBe('downloaded');
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(readFileSync(join(dir, 'a.wasm')).equals(CONTENT)).toBe(true);
    });

    it('rejects a wrong hash and does not write the file', async () => {
      const fetchFn = fakeFetch(CONTENT);
      const spec = { name: 'b.wasm', url: 'https://example.test/b.wasm', sha256: BAD_HASH };
      await expect(ensureParser(spec, dir, fetchFn)).rejects.toThrow(/checksum mismatch/i);
      expect(existsSync(join(dir, 'b.wasm'))).toBe(false);
    });

    it('does not overwrite an existing file when the download hash is wrong', async () => {
      const p = join(dir, 'c.wasm');
      const original = Buffer.from('original');
      writeFileSync(p, original);
      const fetchFn = fakeFetch(CONTENT);
      const spec = { name: 'c.wasm', url: 'https://example.test/c.wasm', sha256: BAD_HASH };
      await expect(ensureParser(spec, dir, fetchFn)).rejects.toThrow(/checksum mismatch/i);
      expect(readFileSync(p).equals(original)).toBe(true);
    });

    it('skips the download when the file already has the correct hash', async () => {
      writeFileSync(join(dir, 'd.wasm'), CONTENT);
      const fetchFn = fakeFetch(CONTENT);
      const spec = { name: 'd.wasm', url: 'https://example.test/d.wasm', sha256: GOOD_HASH };
      const result = await ensureParser(spec, dir, fetchFn);
      expect(result).toBe('skipped');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('throws on a non-OK HTTP status and writes nothing', async () => {
      const fetchFn = fakeFetch(Buffer.from('nope'), 404);
      const spec = { name: 'e.wasm', url: 'https://example.test/e.wasm', sha256: GOOD_HASH };
      await expect(ensureParser(spec, dir, fetchFn)).rejects.toThrow(/404/);
      expect(existsSync(join(dir, 'e.wasm'))).toBe(false);
    });
  });
});
