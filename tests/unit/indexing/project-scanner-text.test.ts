/**
 * Inclusion rules of the text tier (M1-04): which files without a grammar are
 * indexed as text, and which are skipped.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProject, scanFile, type ScannedFile } from '../../../src/indexing/project-scanner.js';
import {
  TEXT_TIER_MAX_FILE_BYTES,
  TEXT_TIER_MAX_LINE_LENGTH,
  textFileSkipReason,
} from '../../../src/indexing/text-file-filter.js';
import { defaultConfig } from '../../../src/config/defaults.js';

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'text-tier');

function byRelPath(root: string, files: ScannedFile[]): Map<string, ScannedFile> {
  return new Map(files.map((f) => [relative(root, f.filePath).split('\\').join('/'), f]));
}

describe('scanProject — text tier on the fixture', () => {
  const files = byRelPath(FIXTURE_DIR, scanProject(FIXTURE_DIR, defaultConfig));

  it('lists files without a grammar as text-tier files with a language label', () => {
    const expected: Record<string, string> = {
      'db/schema.sql': 'sql',
      'scripts/deploy.zsh': 'shell',
      'build.zig': 'zig',
      Dockerfile: 'dockerfile',
      Makefile: 'makefile',
      'legacy/payroll.cobol': 'cobol',
      'notes.xyzzy': 'text',
    };
    for (const [path, language] of Object.entries(expected)) {
      expect(files.get(path), path).toMatchObject({ language, tier: 'text' });
    }
  });

  it('keeps files with a grammar in the parsed tier', () => {
    expect(files.get('src/app.ts')).toMatchObject({ language: 'typescript', tier: 'parsed' });
  });

  it('skips the binary, the lockfile and the minified files', () => {
    expect(files.has('assets/firmware.blob')).toBe(false);
    expect(files.has('package-lock.json')).toBe(false);
    expect(files.has('vendor/theme.min.css')).toBe(false);
    expect(files.has('vendor/bundle.txt')).toBe(false);
    expect([...files.keys()].sort()).toEqual([
      'Dockerfile',
      'Makefile',
      'build.zig',
      'db/schema.sql',
      'legacy/payroll.cobol',
      'notes.xyzzy',
      'scripts/deploy.zsh',
      'src/app.ts',
    ]);
  });
});

describe('textFileSkipReason', () => {
  const text = Buffer.from('plain text\nsecond line\n');
  const reason = (name: string, sample: Buffer = text, size = sample.length): string | null =>
    textFileSkipReason(name, size, () => sample);

  it('accepts ordinary text files', () => {
    for (const name of ['schema.sql', 'Makefile', 'notes.xyzzy', 'config.yaml', 'README.md', 'package.json']) {
      expect(reason(name), name).toBeNull();
    }
  });

  it('skips a file with a NUL byte in its first 8 KB', () => {
    expect(reason('data.xyz', Buffer.from([0x61, 0x00, 0x62]))).toBe('binary');
  });

  it('skips UTF-16 text (it reads as NUL-separated bytes)', () => {
    expect(reason('utf16.txt', Buffer.from('hello', 'utf16le'))).toBe('binary');
  });

  it('skips lockfiles by name', () => {
    for (const name of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'go.sum', 'poetry.lock', 'Gemfile.lock']) {
      expect(reason(name), name).toBe('lockfile');
    }
  });

  it('skips images, archives, compiled and media files by extension without reading them', () => {
    const neverRead = (): Buffer => {
      throw new Error('must not read the file');
    };
    for (const name of ['logo.png', 'icon.SVG', 'a.zip', 'lib.so', 'app.wasm', 'Main.class', 'font.woff2', 'clip.mp4', 'doc.pdf', 'data.sqlite']) {
      expect(textFileSkipReason(name, 10, neverRead), name).toBe('non-source extension');
    }
  });

  it('skips generated files: source maps, minified files, snapshots', () => {
    for (const name of ['app.js.map', 'theme.min.css', 'vendor.min.js', 'component.test.ts.snap']) {
      expect(reason(name), name).toBe('generated');
    }
  });

  it('skips bulk data files', () => {
    for (const name of ['export.csv', 'events.jsonl', 'server.log', 'rows.tsv']) {
      expect(reason(name), name).toBe('data');
    }
  });

  it('skips files that usually hold secrets', () => {
    for (const name of ['.env', '.env.production', 'server.pem', 'id_rsa', 'tls.key', 'prod.tfvars']) {
      expect(reason(name), name).toBe('secrets');
    }
  });

  it('skips a file with a very long line (minified or generated)', () => {
    const long = Buffer.from(`short\n${'x'.repeat(TEXT_TIER_MAX_LINE_LENGTH + 1)}\n`);
    expect(reason('bundle.txt', long)).toBe('long lines');
    const justFits = Buffer.from(`short\n${'x'.repeat(TEXT_TIER_MAX_LINE_LENGTH)}\n`);
    expect(reason('wide.txt', justFits)).toBeNull();
  });

  it('skips files above the text-tier size cap', () => {
    expect(reason('big.sql', text, TEXT_TIER_MAX_FILE_BYTES + 1)).toBe('too large');
    expect(reason('ok.sql', text, TEXT_TIER_MAX_FILE_BYTES)).toBeNull();
  });

  it('skips empty files', () => {
    expect(reason('empty.sql', Buffer.alloc(0), 0)).toBe('empty');
  });
});

describe('scanProject — text tier rules on a temp project', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-text-scan-')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, content: string | Buffer): string {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    return full;
  }

  const scannedPaths = (config = defaultConfig): string[] =>
    [...byRelPath(root, scanProject(root, config)).keys()].sort();

  it('respects .gitignore, user ignore patterns and always-ignored directories', () => {
    write('.gitignore', 'secret/\n');
    write('keep.sql', 'SELECT 1;\n');
    write('secret/hidden.sql', 'SELECT 2;\n');
    write('skipme/x.sql', 'SELECT 3;\n');
    write('node_modules/pkg/readme.txt', 'hello\n');
    write('coverage/report.txt', 'hello\n');
    write('.hidden/x.sql', 'SELECT 4;\n');
    expect(scannedPaths({ ...defaultConfig, ignore: ['skipme/'] })).toEqual(['keep.sql']);
  });

  it('respects the configured size limit', () => {
    write('small.sql', 'SELECT 1;\n');
    write('large.sql', `${'SELECT 1;\n'.repeat(100)}`);
    expect(scannedPaths({ ...defaultConfig, maxFileSizeBytes: 100 })).toEqual(['small.sql']);
  });

  it('never indexes .env files', () => {
    write('.env', 'API_KEY=secret\n');
    write('a.sql', 'SELECT 1;\n');
    expect(scannedPaths()).toEqual(['a.sql']);
  });

  it.skipIf(process.platform === 'win32')('skips symlinked text files', () => {
    const target = write('real.sql', 'SELECT 1;\n');
    symlinkSync(target, join(root, 'link.sql'));
    expect(scannedPaths()).toEqual(['real.sql']);
  });

  it('applies the language filter to text labels', () => {
    write('a.sql', 'SELECT 1;\n');
    write('b.rb', 'puts 1\n');
    write('c.ts', 'export const c = 1;\n');
    write('d.xyzzy', 'plain\n');
    expect(scannedPaths({ ...defaultConfig, languages: ['sql'] })).toEqual(['a.sql']);
    expect(scannedPaths({ ...defaultConfig, languages: ['typescript'] })).toEqual(['c.ts']);
    expect(scannedPaths({ ...defaultConfig, languages: ['text'] })).toEqual(['d.xyzzy']);
    expect(scannedPaths()).toEqual(['a.sql', 'b.rb', 'c.ts', 'd.xyzzy']);
  });

  describe('scanFile (one path, same rules as the walk)', () => {
    it('classifies a text file and a parsed file', () => {
      const sql = write('db/a.sql', 'SELECT 1;\n');
      const ts = write('src/c.ts', 'export const c = 1;\n');
      expect(scanFile(root, sql, defaultConfig)).toMatchObject({ filePath: sql, language: 'sql', tier: 'text' });
      expect(scanFile(root, ts, defaultConfig)).toMatchObject({ filePath: ts, language: 'typescript', tier: 'parsed' });
    });

    it('returns null for files the walk would not list', () => {
      write('.gitignore', 'secret/\n');
      const cases = [
        write('secret/hidden.sql', 'SELECT 2;\n'),
        write('node_modules/pkg/readme.txt', 'hello\n'),
        write('.claude/notes.txt', 'hello\n'),
        write('bin/tool.blob', Buffer.from([1, 0, 2])),
        write('yarn.lock', 'lock\n'),
        join(root, 'missing.sql'),
        resolve(root, '..', 'outside.sql'),
      ];
      for (const path of cases) {
        expect(scanFile(root, path, defaultConfig), path).toBeNull();
      }
    });
  });
});
