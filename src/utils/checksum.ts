import { createHash } from 'node:crypto';

/** Lowercase hex sha256 of `buf`. */
export function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Throws if `buf` does not hash to `expected`. */
export function verifyChecksum(buf: Uint8Array, expected: string, name: string): void {
  const actual = sha256(buf);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
  }
}
