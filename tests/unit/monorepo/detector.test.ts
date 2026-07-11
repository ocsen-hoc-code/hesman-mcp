import { describe, it, expect } from 'vitest';
import { detectWorkspace } from '../../../src/monorepo/detector';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', '..', 'fixtures', 'monorepo-basic');

describe('detectWorkspace', () => {
  describe('pnpm workspace', () => {
    it('detects pnpm workspace from fixture directory', () => {
      const result = detectWorkspace(FIXTURE_DIR);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('pnpm');
      expect(result!.root).toBe(FIXTURE_DIR);
    });

    it('resolves package directory structure correctly', () => {
      const result = detectWorkspace(FIXTURE_DIR);
      expect(result).not.toBeNull();
      expect(result!.packages).toHaveLength(2);

      const pkgA = result!.packages.find((p) => p.relativePath === 'packages/pkg-a');
      expect(pkgA).toBeDefined();
      expect(pkgA!.name).toBe('@monorepo/pkg-a');
      expect(pkgA!.path).toBe(join(FIXTURE_DIR, 'packages/pkg-a'));

      const pkgB = result!.packages.find((p) => p.relativePath === 'packages/pkg-b');
      expect(pkgB).toBeDefined();
      expect(pkgB!.name).toBe('@monorepo/pkg-b');
      expect(pkgB!.path).toBe(join(FIXTURE_DIR, 'packages/pkg-b'));
    });

    it('detects from a deeply nested path within the workspace', () => {
      const nestedPath = join(FIXTURE_DIR, 'packages', 'pkg-a', 'src');
      const result = detectWorkspace(nestedPath);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('pnpm');
      expect(result!.root).toBe(FIXTURE_DIR);
      expect(result!.packages).toHaveLength(2);
    });

    it('returns null for a non-workspace directory', () => {
      // A temp directory with no workspace markers
      const tempDir = join(tmpdir(), `detector-test-${randomUUID()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const result = detectWorkspace(tempDir);
        expect(result).toBeNull();
      } finally {
        // Cleanup
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // ignore cleanup errors
        }
      }
    });
  });

  describe('directory walking', () => {
    it('stops at .git boundary and returns null', () => {
      const tempDir = join(tmpdir(), `detector-test-git-${randomUUID()}`);
      mkdirSync(tempDir, { recursive: true });
      // Create a .git directory to mark a project boundary
      mkdirSync(join(tempDir, '.git'), { recursive: true });
      try {
        const result = detectWorkspace(tempDir);
        expect(result).toBeNull();
      } finally {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it('detects npm workspaces via package.json', () => {
      const tempDir = join(tmpdir(), `detector-test-npm-${randomUUID()}`);
      mkdirSync(tempDir, { recursive: true });
      mkdirSync(join(tempDir, 'packages', 'pkg-a'), { recursive: true });
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'npm-workspace',
          workspaces: ['packages/*'],
        }),
      );
      writeFileSync(
        join(tempDir, 'packages', 'pkg-a', 'package.json'),
        JSON.stringify({ name: '@ws/pkg-a', version: '1.0.0' }),
      );

      try {
        const result = detectWorkspace(tempDir);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('npm');
        expect(result!.packages).toHaveLength(1);
        expect(result!.packages[0].name).toBe('@ws/pkg-a');
      } finally {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it('detects npm workspaces with object form (workspaces.packages)', () => {
      const tempDir = join(tmpdir(), `detector-test-npm2-${randomUUID()}`);
      mkdirSync(tempDir, { recursive: true });
      mkdirSync(join(tempDir, 'packages', 'pkg-a'), { recursive: true });
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'npm-workspace-obj',
          workspaces: {
            packages: ['packages/*'],
          },
        }),
      );
      writeFileSync(
        join(tempDir, 'packages', 'pkg-a', 'package.json'),
        JSON.stringify({ name: '@ws/pkg-a', version: '1.0.0' }),
      );

      try {
        const result = detectWorkspace(tempDir);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('npm');
        expect(result!.packages).toHaveLength(1);
      } finally {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });
  });

  describe('workspace types', () => {
    it('detects lerna workspace from lerna.json', () => {
      const tempDir = join(tmpdir(), `detector-test-lerna-${randomUUID()}`);
      mkdirSync(tempDir, { recursive: true });
      mkdirSync(join(tempDir, 'packages', 'pkg-a'), { recursive: true });
      writeFileSync(
        join(tempDir, 'lerna.json'),
        JSON.stringify({ packages: ['packages/*'], version: 'independent' }),
      );
      writeFileSync(
        join(tempDir, 'packages', 'pkg-a', 'package.json'),
        JSON.stringify({ name: '@lerna/pkg-a', version: '1.0.0' }),
      );

      try {
        const result = detectWorkspace(tempDir);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('lerna');
        expect(result!.packages).toHaveLength(1);
        expect(result!.packages[0].name).toBe('@lerna/pkg-a');
      } finally {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it('detects nx workspace from nx.json', () => {
      const tempDir = join(tmpdir(), `detector-test-nx-${randomUUID()}`);
      mkdirSync(tempDir, { recursive: true });
      mkdirSync(join(tempDir, 'packages', 'nx-pkg'), { recursive: true });
      writeFileSync(
        join(tempDir, 'nx.json'),
        JSON.stringify({ npmScope: 'nx-ws', workspaceLayout: { appsDir: 'apps', libsDir: 'libs' } }),
      );
      writeFileSync(
        join(tempDir, 'packages', 'nx-pkg', 'package.json'),
        JSON.stringify({ name: '@nx/nx-pkg', version: '1.0.0' }),
      );

      try {
        const result = detectWorkspace(tempDir);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('nx');
        // NX may also detect packages/ from known patterns
        expect(result!.packages.length).toBeGreaterThanOrEqual(1);
      } finally {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it('detects turbo workspace from turbo.json with npm-style workspaces', () => {
      const tempDir = join(tmpdir(), `detector-test-turbo-${randomUUID()}`);
      mkdirSync(tempDir, { recursive: true });
      mkdirSync(join(tempDir, 'apps', 'web'), { recursive: true });
      writeFileSync(
        join(tempDir, 'turbo.json'),
        JSON.stringify({ pipeline: { build: { outputs: ['dist/**'] } } }),
      );
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'turbo-workspace',
          workspaces: ['apps/*'],
        }),
      );
      writeFileSync(
        join(tempDir, 'apps', 'web', 'package.json'),
        JSON.stringify({ name: '@turbo/web', version: '1.0.0' }),
      );

      try {
        const result = detectWorkspace(tempDir);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('turbo');
        expect(result!.packages).toHaveLength(1);
        expect(result!.packages[0].name).toBe('@turbo/web');
      } finally {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });
  });
});
