import { writeFileSync, mkdirSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ParserSpec {
  name: string;
  url: string;
  sha256: string;
}

/** Pinned parser binaries. sha256 values match the copies committed in `parsers/`. */
export const PARSERS: readonly ParserSpec[] = [
  {
    name: 'tree-sitter-typescript.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm',
    sha256: '778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d',
  },
  {
    name: 'tree-sitter-python.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm',
    sha256: '8c93692fb368e288a5824cee55773c9b3602804f513bda48c97661e52e9c2da2',
  },
  {
    name: 'tree-sitter-go.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm',
    sha256: '6dfc8eacdad0a54d0cad0d888851bd19cdd14d82582f110f888bbf6f9e5e2d64',
  },
];

export const OUT_DIR = fileURLToPath(new URL('../parsers', import.meta.url));

export type FetchFn = (url: string) => Promise<Response>;

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Throws if `buf` does not hash to `expected`. */
export function verifyChecksum(buf: Buffer, expected: string, name: string): void {
  const actual = sha256(buf);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
  }
}

/** True when `path` exists and its content hashes to `expected`. */
export function hasValidFile(path: string, expected: string): boolean {
  if (!existsSync(path)) return false;
  return sha256(readFileSync(path)) === expected.toLowerCase();
}

/**
 * Ensures `outDir/spec.name` exists with the pinned hash. Skips the download when the
 * file is already valid; otherwise downloads, verifies, and only then writes the file.
 */
export async function ensureParser(
  spec: ParserSpec,
  outDir: string,
  fetchFn: FetchFn = fetch,
): Promise<'skipped' | 'downloaded'> {
  const outPath = join(outDir, spec.name);
  if (hasValidFile(outPath, spec.sha256)) return 'skipped';

  const res = await fetchFn(spec.url);
  if (!res.ok) throw new Error(`Failed to download ${spec.name}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  verifyChecksum(buf, spec.sha256, spec.name);
  writeFileSync(outPath, buf);
  return 'downloaded';
}

async function main(): Promise<void> {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  for (const spec of PARSERS) {
    const result = await ensureParser(spec, OUT_DIR);
    if (result === 'skipped') {
      console.log(`${spec.name}: up to date (sha256 verified), skipping`);
    } else {
      console.log(`${spec.name}: downloaded and verified → ${join(OUT_DIR, spec.name)}`);
    }
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const a = realpathSync(resolve(entry));
    const b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
