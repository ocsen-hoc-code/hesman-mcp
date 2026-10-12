import { writeFileSync, mkdirSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ParserSpec {
  name: string;
  url: string;
  sha256: string;
}

/**
 * Pinned parser binaries: the bundled core set of ADR 0001 (section 10), each the `.wasm` asset of
 * the grammar's own upstream GitHub release. sha256 values match the copies committed in `parsers/`.
 */
export const PARSERS: readonly ParserSpec[] = [
  {
    name: 'tree-sitter-typescript.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm',
    sha256: '778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d',
  },
  {
    name: 'tree-sitter-tsx.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-tsx.wasm',
    sha256: '79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8',
  },
  {
    name: 'tree-sitter-javascript.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.23.1/tree-sitter-javascript.wasm',
    sha256: '4a378293fe7853cbee2836023be072dafa0e53b3b5edb245920838ca834ed121',
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
  {
    name: 'tree-sitter-java.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm',
    sha256: '4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4',
  },
  {
    name: 'tree-sitter-c.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.2/tree-sitter-c.wasm',
    sha256: '83e8d7902b9d7f8c7c5cd4bd9acb5c7eb5faf42c09f85546b183964d3b5f48f9',
  },
  {
    name: 'tree-sitter-cpp.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm',
    sha256: '174eb0deb75b2ec7881bcacda9f995648d8e683956e5c2267e69ab6dc503fcbf',
  },
  {
    name: 'tree-sitter-c_sharp.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.5/tree-sitter-c_sharp.wasm',
    sha256: '6f69e1cae44e1c32c1eccc170dc5a9778fb94ff716f71113fe1f8c4299aa2f40',
  },
  {
    name: 'tree-sitter-rust.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.2/tree-sitter-rust.wasm',
    sha256: '24c89bd9252255e4aebbcbd7d2d308bd92c86dd95a130fdc80efa49577b8d738',
  },
  {
    name: 'tree-sitter-php.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.25.1/tree-sitter-php.wasm',
    sha256: 'bd5e2bf8d42306b7aa32e6b7e39ae9fd9543c62a875ad8b2bc3d488242f72817',
  },
  {
    name: 'tree-sitter-ruby.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm',
    sha256: '09a96427d7c72f0613ed470cd9812223fc4a91d6a9c025c0235cc6bd59ff96f4',
  },
  {
    name: 'tree-sitter-kotlin.wasm',
    url: 'https://github.com/fwcd/tree-sitter-kotlin/releases/download/0.3.8/tree-sitter-kotlin.wasm',
    sha256: 'c624e7443b371c28adc5d81674e73067564c12555ebe3ed96a6c8db814b7602d',
  },
  {
    name: 'tree-sitter-swift.wasm',
    url: 'https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.3/tree-sitter-swift.wasm',
    sha256: '0258a7ef17303a8079ffe0748b3583d59656b5c3e8653fca7b6451b3e6689eb2',
  },
  {
    name: 'tree-sitter-bash.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.1/tree-sitter-bash.wasm',
    sha256: '8292919c88a0f7d3fb31d0cd0253ca5a9531bc1ede82b0537f2c63dd8abe6a7a',
  },
  {
    name: 'tree-sitter-lua.wasm',
    url: 'https://github.com/tree-sitter-grammars/tree-sitter-lua/releases/download/v0.5.0/tree-sitter-lua.wasm',
    sha256: 'df08a1704e504c70b8dba4a3e6f8e0c99a4fb94e1b1693d2969f53141d09f0d4',
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
