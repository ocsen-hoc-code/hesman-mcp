import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'web-tree-sitter';
import { LANGUAGES, QUERIES_DIR, tagsQueryFiles } from '../../../src/parsers/languages';
import { compileTagsQueries, loadGrammar, queryLayersOf } from '../../conformance/helpers';
import { PARSERS } from '../../../scripts/download-parsers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..', '..');

interface QuerySource {
  path: string;
  origin: 'upstream' | 'hesman';
  repo?: string;
  rev?: string;
  commit?: string;
  license: string;
  sha256?: string;
  note?: string;
}

const SOURCES = (JSON.parse(readFileSync(join(REPO, 'queries', 'SOURCES.json'), 'utf-8')) as { queries: QuerySource[] })
  .queries;

function queryFilesOnDisk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) queryFilesOnDisk(path, out);
    else if (entry.endsWith('.scm')) out.push(relative(QUERIES_DIR, path).split(sep).join('/'));
  }
  return out.sort();
}

describe('vendored tags queries', () => {
  beforeAll(async () => {
    await Parser.init();
  });

  it('resolves the queries directory at the repository root', () => {
    expect(QUERIES_DIR).toBe(join(REPO, 'queries'));
  });

  it.each(LANGUAGES.map((l) => [l.id, l] as const))('%s has a tags query and every layer exists', (_id, def) => {
    const files = tagsQueryFiles(def);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(existsSync(file)).toBe(true);
  });

  const layersOf = (id: string): string[] =>
    tagsQueryFiles(LANGUAGES.find((l) => l.id === id)!).map((f) => relative(QUERIES_DIR, f).split(sep).join('/'));

  it('layers the TypeScript and TSX queries on the JavaScript query, Hesman gap fillers last', () => {
    const layers = ['javascript/tags.scm', 'typescript/tags.scm', 'typescript/hesman-tags.scm'];
    expect(layersOf('typescript')).toEqual(layers);
    // The TSX grammar is the TypeScript grammar plus JSX, built from the same repository and tag.
    expect(layersOf('tsx')).toEqual(layers);
    expect(layersOf('javascript')[0]).toBe('javascript/tags.scm');
  });

  // The conformance suite (tests/conformance/) repeats this per layer, next to the
  // fixture checks; both use the same helpers, which name the language and the file.
  it.each(LANGUAGES.map((l) => [l.id, l] as const))(
    '%s: every layer compiles against the committed grammar',
    async (_id, def) => {
      compileTagsQueries(def, await loadGrammar(def));
    },
  );

  it('reports the language and the query file when a query does not fit the grammar', async () => {
    const def = LANGUAGES[0];
    const language = await loadGrammar(def);
    const broken = { name: 'broken/tags.scm', file: join(REPO, 'package.json') };
    expect(() => compileTagsQueries(def, language, [...queryLayersOf(def), broken])).toThrow(
      new RegExp(`^\\[${def.id}\\] Tags query queries/broken/tags\\.scm does not compile for this grammar: .*parsers/${def.grammar}`, 's'),
    );
  });

  it('records the provenance of every query file, and nothing else', () => {
    expect(SOURCES.map((s) => s.path).sort()).toEqual(queryFilesOnDisk(QUERIES_DIR));
  });

  it('uses only queries the owner allowed: the grammar\'s own upstream repository or Hesman, all MIT', () => {
    // ADR 0001, section 10: no Helix (MPL-2.0) or Aider (Apache-2.0) queries.
    const grammarRepos = new Set(PARSERS.map((p) => /^(https:\/\/github\.com\/[^/]+\/[^/]+)\//.exec(p.url)![1]));
    for (const source of SOURCES) {
      expect(source.license).toBe('MIT');
      if (source.origin === 'upstream') {
        expect(grammarRepos, `${source.path} must come from the repository of a pinned grammar`).toContain(source.repo);
        expect(source.rev).toMatch(/^v?\d+\.\d+\.\d+$|^[0-9a-f]{7,40}$/);
        expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      } else {
        expect(source.origin).toBe('hesman');
        expect(source.path).toMatch(/\/hesman-[a-z]+\.scm$/);
      }
    }
  });

  it('vendors an upstream query at the tag of the pinned grammar, or says why not', () => {
    for (const source of SOURCES.filter((s) => s.origin === 'upstream')) {
      const pinned = PARSERS.filter((p) => p.url.startsWith(`${source.repo}/releases/download/${source.rev}/`));
      if (pinned.length === 0) expect(source.note, `${source.path} is not at a pinned grammar tag and has no "note"`).toBeTruthy();
    }
  });

  it.each(SOURCES.filter((s) => s.origin === 'upstream').map((s) => [s.path, s] as const))(
    '%s is the unmodified upstream file',
    (_path, source) => {
      const bytes = readFileSync(join(QUERIES_DIR, source.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
    },
  );

  it('attributes every vendored query in NOTICE', () => {
    const notice = readFileSync(join(REPO, 'NOTICE'), 'utf-8');
    for (const source of SOURCES) {
      expect(notice).toContain(`queries/${source.path}`);
      if (source.origin === 'upstream') {
        expect(notice).toContain(source.repo!);
        expect(notice).toContain(`${source.rev} (${source.commit})`);
      }
    }
    expect(notice).toContain('Permission is hereby granted, free of charge');
  });

  it('ships queries/ and NOTICE in the npm package', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')) as { files: string[] };
    expect(pkg.files).toContain('queries/');
    expect(pkg.files).toContain('NOTICE');
  });
});
