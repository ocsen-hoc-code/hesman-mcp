/**
 * Inclusion rule of the text tier (M1-04): which files *without a grammar*
 * are worth indexing as text.
 *
 * The rule is deliberately conservative. A wrongly included file costs every
 * user embedding time and index size, while a wrongly skipped file only stays
 * as invisible as it was before the text tier existed.
 *
 * A file is indexed as text unless one of these holds (checked in this order):
 *
 * | Reason                 | Rule                                                                |
 * |------------------------|---------------------------------------------------------------------|
 * | `secrets`              | `.env*`, private keys and certificates, `*.tfvars`, `id_rsa` & co.   |
 * | `lockfile`             | dependency lockfiles by name (`package-lock.json`, `go.sum`, ...)   |
 * | `non-source extension` | images, fonts, audio/video, archives, compiled objects, office docs |
 * | `generated`            | `*.map`, `*.min.*`, `*.snap`, `*.bundle.*`, `*.generated.*`, ...    |
 * | `data`                 | bulk data and logs (`.csv`, `.tsv`, `.jsonl`, `.log`, ...)          |
 * | `empty`                | 0 bytes                                                             |
 * | `too large`            | above `TEXT_TIER_MAX_FILE_BYTES` (256 KB)                           |
 * | `binary`               | a NUL byte in the first 8 KB (this also drops UTF-16/UTF-32 text)   |
 * | `long lines`           | a line above `TEXT_TIER_MAX_LINE_LENGTH` in the first 8 KB          |
 *
 * The scanner applies its own rules first: the configured `maxFileSizeBytes`,
 * `.gitignore` / `ignore` patterns, always-ignored directories, dotfiles and
 * symlinks. Only the last two checks read the file (8 KB at most).
 */
import { closeSync, openSync, readSync } from 'node:fs';

/** Bytes inspected for the binary and long-line checks. */
export const TEXT_SNIFF_BYTES = 8 * 1024;

/**
 * Size cap of the text tier, below the general `maxFileSizeBytes` (2 MB by
 * default). Hand-written source rarely exceeds it; dumps, fixtures and
 * generated files do, and each 256 KB of text is roughly 200 embeddings.
 */
export const TEXT_TIER_MAX_FILE_BYTES = 256 * 1024;

/** A line longer than this (in the sniffed bytes) marks minified or generated content. */
export const TEXT_TIER_MAX_LINE_LENGTH = 2_000;

export type TextSkipReason =
  | 'secrets'
  | 'lockfile'
  | 'non-source extension'
  | 'generated'
  | 'data'
  | 'empty'
  | 'too large'
  | 'binary'
  | 'long lines';

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'pdm.lock',
  'go.sum',
  'go.work.sum',
  'flake.lock',
  'mix.lock',
  'pubspec.lock',
  'podfile.lock',
  'cartfile.resolved',
  'package.resolved',
  'packages.lock.json',
  'gradle.lockfile',
  'conan.lock',
  'paket.lock',
  'renv.lock',
  'manifest.toml',
  '.terraform.lock.hcl',
]);

const SECRET_NAMES = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'htpasswd',
  '.htpasswd',
  '.netrc',
  '.npmrc',
  '.pypirc',
]);

const SECRET_EXTENSIONS = new Set([
  '.pem', '.key', '.crt', '.cer', '.der', '.p12', '.pfx', '.jks', '.keystore', '.asc', '.gpg', '.pgp',
  '.tfvars', '.tfstate', '.kdbx',
]);

const NON_SOURCE_EXTENSIONS = new Set([
  // images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.icns', '.webp', '.avif', '.tif', '.tiff', '.psd', '.ai',
  '.eps', '.svg', '.svgz', '.heic', '.xcf', '.sketch', '.fig',
  // fonts
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // audio / video
  '.mp3', '.mp4', '.m4a', '.m4v', '.mov', '.avi', '.mkv', '.webm', '.wav', '.ogg', '.flac', '.aac',
  // archives and packages
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.zst', '.7z', '.rar', '.jar', '.war', '.ear', '.apk', '.ipa',
  '.deb', '.rpm', '.dmg', '.iso', '.whl', '.gem', '.nupkg', '.crate',
  // compiled code and objects
  '.exe', '.dll', '.so', '.dylib', '.a', '.lib', '.o', '.obj', '.class', '.pyc', '.pyo', '.pyd', '.wasm',
  '.bin', '.elf', '.out', '.pdb', '.node', '.beam',
  // databases and binary data
  '.db', '.sqlite', '.sqlite3', '.mdb', '.parquet', '.avro', '.orc', '.npy', '.npz', '.pkl', '.pickle',
  '.h5', '.hdf5', '.onnx', '.pt', '.pth', '.safetensors', '.tflite', '.pb', '.dat',
  // office documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.epub',
]);

const GENERATED_EXTENSIONS = new Set(['.map', '.snap', '.lock', '.orig', '.rej', '.bak', '.tmp', '.swp']);

/** `name.min.js`, `app.bundle.css`, `api.generated.cs`, `types.pb.go`-style markers before the extension. */
const GENERATED_INFIX = /\.(min|bundle|generated|gen|pb|g|designer)\.[a-z0-9]+$/;

const DATA_EXTENSIONS = new Set(['.csv', '.tsv', '.psv', '.jsonl', '.ndjson', '.log', '.dump', '.ipynb', '.har', '.lcov', '.tap']);

function extensionOf(lowerName: string): string {
  const dot = lowerName.lastIndexOf('.');
  return dot > 0 ? lowerName.slice(dot) : '';
}

/** Reason a file is kept out of the text tier judging by its name alone, or `null`. */
export function textNameSkipReason(fileName: string): TextSkipReason | null {
  const name = fileName.toLowerCase();
  const ext = extensionOf(name);
  if (name === '.env' || name.startsWith('.env.') || SECRET_NAMES.has(name) || SECRET_EXTENSIONS.has(ext)) {
    return 'secrets';
  }
  if (LOCKFILE_NAMES.has(name)) return 'lockfile';
  if (NON_SOURCE_EXTENSIONS.has(ext)) return 'non-source extension';
  if (GENERATED_EXTENSIONS.has(ext) || GENERATED_INFIX.test(name)) return 'generated';
  if (DATA_EXTENSIONS.has(ext)) return 'data';
  return null;
}

/** Reason the first bytes of a file disqualify it, or `null`. */
export function textContentSkipReason(sample: Uint8Array): TextSkipReason | null {
  let lineLength = 0;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if (byte === 0) return 'binary';
    if (byte === 0x0a) {
      lineLength = 0;
    } else if (++lineLength > TEXT_TIER_MAX_LINE_LENGTH) {
      return 'long lines';
    }
  }
  return null;
}

/** First `TEXT_SNIFF_BYTES` bytes of a file. */
export function readTextSample(filePath: string): Buffer {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(TEXT_SNIFF_BYTES);
    const bytesRead = readSync(fd, buffer, 0, TEXT_SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

/**
 * Why a file without a grammar must not be indexed as text, or `null` when it
 * should be. `readSample` is called only when the name and size pass, and
 * returns (at least) the first `TEXT_SNIFF_BYTES` bytes of the file.
 */
export function textFileSkipReason(
  fileName: string,
  sizeBytes: number,
  readSample: () => Uint8Array,
): TextSkipReason | null {
  const byName = textNameSkipReason(fileName);
  if (byName) return byName;
  if (sizeBytes === 0) return 'empty';
  if (sizeBytes > TEXT_TIER_MAX_FILE_BYTES) return 'too large';
  const sample = readSample();
  return textContentSkipReason(sample.length > TEXT_SNIFF_BYTES ? sample.subarray(0, TEXT_SNIFF_BYTES) : sample);
}
