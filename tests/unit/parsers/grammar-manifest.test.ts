import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';
import { loadGrammarManifest, MANIFEST_PATH, type GrammarManifest } from '../../../src/parsers/grammar-store';
import { LANGUAGES } from '../../../src/parsers/languages';
import { PARSERS } from '../../../scripts/download-parsers';
import { ON_DEMAND_GRAMMARS } from '../../../scripts/grammar-catalog';
import { buildManifest, renderManifest } from '../../../scripts/generate-grammar-manifest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** Licenses a grammar may have to be listed (ADR 0001, 4.5: permissive, established at the pinned tag). */
const ALLOWED_LICENSES = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Unlicense', 'CC0-1.0']);

describe('grammars.json', () => {
  let manifest: GrammarManifest;
  beforeAll(async () => {
    await Parser.init();
    manifest = loadGrammarManifest();
  });

  it('sits at the package root and is shipped in the npm package', () => {
    expect(MANIFEST_PATH).toBe(join(REPO, 'grammars.json'));
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')) as { files: string[] };
    expect(pkg.files).toContain('grammars.json');
  });

  it('is what scripts/generate-grammar-manifest.ts generates', async () => {
    expect(readFileSync(MANIFEST_PATH, 'utf-8')).toBe(renderManifest(await buildManifest()));
  });

  it('declares the ABI range of the pinned runtime', () => {
    expect(manifest.abi).toEqual({ min: 13, max: 15 });
  });

  it('lists the 16 bundled grammars under their registry ids, pinned like scripts/download-parsers.ts', () => {
    const bundled = Object.entries(manifest.grammars).filter(([, entry]) => entry.bundled);
    expect(bundled.map(([id]) => id)).toEqual(LANGUAGES.map((l) => l.id));
    for (const [id, entry] of bundled) {
      const def = LANGUAGES.find((l) => l.id === id)!;
      const pinned = PARSERS.find((p) => p.name === def.grammar)!;
      expect(entry.file).toBe(def.grammar);
      expect(entry.url).toBe(pinned.url);
      expect(entry.sha256).toBe(pinned.sha256);
      expect(entry.bytes).toBe(statSync(join(REPO, 'parsers', entry.file)).size);
      expect(entry.extensions).toEqual(def.extensions);
    }
  });

  it('gives every bundled grammar the ABI the committed file really has', async () => {
    for (const entry of Object.values(manifest.grammars).filter((e) => e.bundled)) {
      const language = await Language.load(join(REPO, 'parsers', entry.file));
      expect(entry.abi, entry.file).toBe(language.abiVersion);
    }
  });

  it('offers at least 15 grammars on demand, none of them a bundled language', () => {
    const onDemand = Object.entries(manifest.grammars).filter(([, entry]) => !entry.bundled);
    expect(onDemand.length).toBeGreaterThanOrEqual(15);
    expect(onDemand.map(([id]) => id)).toEqual(ON_DEMAND_GRAMMARS.map((g) => g.id));
    for (const [id] of onDemand) expect(LANGUAGES.some((l) => l.id === id), id).toBe(false);
  });

  it('pins every entry completely: URL, sha256, size, ABI in range, license, source repository and revision', () => {
    for (const [id, entry] of Object.entries(manifest.grammars)) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9+_-]*$/);
      expect(entry.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(entry.bytes) && entry.bytes > 0, id).toBe(true);
      expect(entry.abi, id).toBeGreaterThanOrEqual(manifest.abi.min);
      expect(entry.abi, id).toBeLessThanOrEqual(manifest.abi.max);
      expect(ALLOWED_LICENSES, `${id}: ${entry.source.license}`).toContain(entry.source.license);
      expect(entry.source.repo, id).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
      expect(entry.source.rev, id).toBeTruthy();
      expect(entry.source.commit, id).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.file, id).toMatch(/^tree-sitter-[\w-]+\.wasm$/);
    }
  });

  it('only contains URLs of a release asset of the grammar\'s own repository at the pinned tag', () => {
    for (const [id, entry] of Object.entries(manifest.grammars)) {
      expect(entry.url, id).toBe(
        `${entry.source.repo}/releases/download/${encodeURIComponent(entry.source.rev)}/${entry.file}`,
      );
    }
  });

  it('pins no two grammars to the same file, and no extension twice', () => {
    const entries = Object.values(manifest.grammars);
    expect(new Set(entries.map((e) => e.sha256)).size).toBe(entries.length);
    const extensions = entries.flatMap((e) => e.extensions ?? []);
    expect(new Set(extensions).size).toBe(extensions.length);
    for (const ext of extensions) expect(ext).toMatch(/^\.[a-z0-9+_-]+$/);
  });

  it('gives a tags query and extensions together: a grammar that yields symbols names the files it parses', () => {
    for (const [id, entry] of Object.entries(manifest.grammars)) {
      expect(entry.queries !== undefined, id).toBe(entry.extensions !== undefined);
      for (const path of entry.queries?.tags ?? []) {
        expect(path, id).toMatch(/^queries\/[\w-]+\/[\w-]+\.scm$/);
        expect(existsSync(join(REPO, path)), path).toBe(true);
      }
    }
  });

  it('has at least five on-demand grammars with symbols', () => {
    const withSymbols = Object.values(manifest.grammars).filter((e) => !e.bundled && e.queries);
    expect(withSymbols.length).toBeGreaterThanOrEqual(5);
  });

  it('reports the total size of the on-demand catalog', () => {
    const total = Object.values(manifest.grammars).filter((e) => !e.bundled).reduce((sum, e) => sum + e.bytes, 0);
    expect(total).toBe(ON_DEMAND_GRAMMARS.reduce((sum, g) => sum + g.bytes, 0));
    // Not a budget of the npm package (nothing of this is shipped); a guard against pinning a huge grammar by accident.
    expect(total).toBeLessThan(64 * 1024 * 1024);
  });
});

describe('the committed on-demand grammar fixture', () => {
  // tests/fixtures/grammars/tree-sitter-r.wasm is the real release asset (MIT), so the on-demand
  // path is tested with a grammar that loads, without the network.
  const fixture = join(REPO, 'tests', 'fixtures', 'grammars', 'tree-sitter-r.wasm');

  it('is byte for byte the grammar the manifest pins for R', () => {
    const entry = loadGrammarManifest().grammars.r;
    const bytes = readFileSync(fixture);
    expect(bytes.length).toBe(entry.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
  });

  it('loads in the pinned runtime with the ABI the manifest states', async () => {
    await Parser.init();
    const language = await Language.load(fixture);
    expect(language.abiVersion).toBe(loadGrammarManifest().grammars.r.abi);
  });
});
