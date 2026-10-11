import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'web-tree-sitter';
import { LANGUAGES, QUERIES_DIR, tagsQueryFiles } from '../../../src/parsers/languages';
import { compileTagsQueries, loadGrammar, queryLayersOf } from '../../conformance/helpers';

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

  it('layers the TypeScript queries on the JavaScript query, Hesman gap fillers last', () => {
    const def = LANGUAGES.find((l) => l.id === 'typescript')!;
    expect(tagsQueryFiles(def).map((f) => relative(QUERIES_DIR, f).split(sep).join('/'))).toEqual([
      'javascript/tags.scm',
      'typescript/tags.scm',
      'typescript/hesman-tags.scm',
    ]);
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

  it('uses only queries the owner allowed: upstream grammar repositories and Hesman, all MIT', () => {
    for (const source of SOURCES) {
      expect(source.license).toBe('MIT');
      if (source.origin === 'upstream') {
        expect(source.repo).toMatch(/^https:\/\/github\.com\/tree-sitter\/tree-sitter-[a-z-]+$/);
        expect(source.rev).toMatch(/^v\d+\.\d+\.\d+$/);
        expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      } else {
        expect(source.origin).toBe('hesman');
        expect(source.path).toMatch(/\/hesman-[a-z]+\.scm$/);
      }
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
