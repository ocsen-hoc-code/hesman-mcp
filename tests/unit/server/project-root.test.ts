import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  explicitProjectRoot,
  findProjectRoot,
  noProjectMessage,
  noProjectResult,
  pickProjectRoot,
  rootUriToPath,
} from '../../../src/server/project-root.js';

describe('project root resolution', () => {
  let base: string;
  let home: string;

  beforeEach(() => {
    // realpath: on macOS the temp dir is reached through a symlink.
    base = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-root-')));
    home = join(base, 'home');
    mkdirSync(home);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function makeDir(...parts: string[]): string {
    const dir = join(base, ...parts);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  describe('explicitProjectRoot', () => {
    it('returns null when neither flag, env var nor config file names a project', () => {
      expect(explicitProjectRoot('.', {}, {}, base)).toBeNull();
    });

    it('resolves a root given by the CLI flag, even "."', () => {
      expect(explicitProjectRoot('.', { projectRoot: '.' }, {}, base)).toBe(base);
    });

    it('resolves a root given by HESMAN_PROJECT_ROOT', () => {
      expect(explicitProjectRoot('sub', {}, { HESMAN_PROJECT_ROOT: 'sub' }, base)).toBe(join(base, 'sub'));
    });

    it('resolves a root set in the config file', () => {
      expect(explicitProjectRoot('/abs/project', {}, {}, base)).toBe('/abs/project');
    });
  });

  describe('rootUriToPath', () => {
    it('converts a file:// URI to a path', () => {
      const dir = makeDir('with space');
      expect(rootUriToPath(pathToFileURL(dir).href)).toBe(dir);
    });

    it('returns null for other schemes and malformed URIs', () => {
      expect(rootUriToPath('https://example.com/repo')).toBeNull();
      expect(rootUriToPath('not a uri')).toBeNull();
      expect(rootUriToPath('file://remote-host/share')).toBeNull();
    });
  });

  describe('pickProjectRoot', () => {
    it('picks the first root and reports the others', () => {
      const a = makeDir('a');
      const b = makeDir('b');
      const picked = pickProjectRoot([{ uri: pathToFileURL(a).href }, { uri: pathToFileURL(b).href }], home);
      expect(picked.root).toBe(a);
      expect(picked.others).toEqual([b]);
      expect(picked.rejected).toEqual([]);
    });

    it('skips roots that are not existing local directories', () => {
      const a = makeDir('a');
      const file = join(base, 'file.txt');
      writeFileSync(file, 'x');
      const picked = pickProjectRoot(
        [
          { uri: 'https://example.com/repo' },
          { uri: pathToFileURL(join(base, 'missing')).href },
          { uri: pathToFileURL(file).href },
          { uri: pathToFileURL(a).href },
        ],
        home,
      );
      expect(picked.root).toBe(a);
      expect(picked.rejected).toHaveLength(3);
    });

    it('never picks the home directory or one of its ancestors', () => {
      const picked = pickProjectRoot([{ uri: pathToFileURL(home).href }, { uri: pathToFileURL(base).href }], home);
      expect(picked.root).toBeNull();
      expect(picked.rejected).toHaveLength(2);
    });

    it('returns no root for an empty list', () => {
      expect(pickProjectRoot([], home)).toEqual({ root: null, others: [], rejected: [] });
    });
  });

  describe('findProjectRoot', () => {
    it('accepts a directory holding a VCS directory', () => {
      const project = makeDir('project');
      mkdirSync(join(project, '.git'));
      expect(findProjectRoot(project, home)).toBe(project);
    });

    it.each(['package.json', 'go.mod', 'pyproject.toml', 'Cargo.toml'])('accepts a directory holding %s', (manifest) => {
      const project = makeDir('project');
      writeFileSync(join(project, manifest), '');
      expect(findProjectRoot(project, home)).toBe(project);
    });

    it('walks up from a subdirectory to the project', () => {
      const project = makeDir('project');
      mkdirSync(join(project, '.git'));
      const nested = makeDir('project', 'src', 'deep');
      expect(findProjectRoot(nested, home)).toBe(project);
    });

    it('returns null when no directory up the tree looks like a project', () => {
      expect(findProjectRoot(makeDir('plain', 'dir'), home)).toBeNull();
    });

    it('never returns the home directory, even when it holds a manifest', () => {
      writeFileSync(join(home, 'package.json'), '{}');
      mkdirSync(join(home, '.git'));
      expect(findProjectRoot(home, home)).toBeNull();
      expect(findProjectRoot(makeDir('home', 'Downloads'), home)).toBeNull();
    });

    it('never returns an ancestor of the home directory', () => {
      writeFileSync(join(base, 'package.json'), '{}');
      expect(findProjectRoot(base, home)).toBeNull();
    });

    it('accepts a project below the home directory', () => {
      const project = makeDir('home', 'code', 'app');
      writeFileSync(join(project, 'package.json'), '{}');
      expect(findProjectRoot(join(project), home)).toBe(project);
    });
  });

  describe('noProjectResult', () => {
    it('is a NO_PROJECT tool error that explains how to set a project', () => {
      const result = noProjectResult('/somewhere');
      expect(result.isError).toBe(true);
      const body = JSON.parse(result.content[0].text) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NO_PROJECT');
      expect(body.error.message).toBe(noProjectMessage('/somewhere'));
      expect(body.error.message).toContain('--project-root');
      expect(body.error.message).toContain('HESMAN_PROJECT_ROOT');
      expect(body.error.message).toContain('/somewhere');
    });
  });
});
