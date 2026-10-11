import { describe, it, expect, afterEach, vi } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { appConfigDir, realEnvironment, xdgConfigDir } from '../../../../src/cli/clients/environment';
import { cleanupEnvs, makeEnv } from './helpers';

let dir = '';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('realEnvironment()', () => {
  it.skipIf(process.platform === 'win32')('findOnPath finds an executable in a PATH directory and ignores plain files and directories', () => {
    dir = mkdtempSync(join(tmpdir(), 'hesman-path-test-'));
    const bin = join(dir, 'bin');
    mkdirSync(join(bin, 'a-directory'), { recursive: true });
    writeFileSync(join(bin, 'fake-client'), '#!/bin/sh\n');
    chmodSync(join(bin, 'fake-client'), 0o755);
    writeFileSync(join(bin, 'not-executable'), '');
    chmodSync(join(bin, 'not-executable'), 0o644);
    vi.stubEnv('PATH', [join(dir, 'missing'), bin].join(delimiter));

    const env = realEnvironment();

    expect(env.findOnPath('fake-client')).toBe(join(bin, 'fake-client'));
    expect(env.findOnPath('not-executable')).toBeUndefined();
    expect(env.findOnPath('a-directory')).toBeUndefined();
    expect(env.findOnPath('absent')).toBeUndefined();
  });

  it('installation describes the running Hesman: this node, the built entry script of this package, its version', () => {
    const root = resolve(__dirname, '../../../..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

    expect(realEnvironment().installation).toEqual({
      execPath: process.execPath,
      entryScript: join(root, 'dist', 'index.js'),
      version: pkg.version,
    });
  });

  it.skipIf(process.platform === 'win32')('realpath follows symbolic links and returns unresolvable paths unchanged', () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-path-test-')));
    writeFileSync(join(dir, 'target'), '');
    symlinkSync(join(dir, 'target'), join(dir, 'link'));

    const env = realEnvironment();

    expect(env.realpath(join(dir, 'link'))).toBe(join(dir, 'target'));
    expect(env.realpath(join(dir, 'missing'))).toBe(join(dir, 'missing'));
  });

  it.skipIf(process.platform === 'win32')('run reports the exit status and output of a command', () => {
    const env = realEnvironment();
    expect(env.run(process.execPath, ['-e', 'console.log("hi"); process.exit(3)'])).toEqual({ status: 3, stdout: 'hi\n', stderr: '' });
    expect(env.run(join(tmpdir(), 'hesman-no-such-binary'), []).status).toBe(-1);
  });
});

describe('config directories', () => {
  it('appConfigDir follows the platform convention', () => {
    const mac = makeEnv({ platform: 'darwin' });
    const win = makeEnv({ platform: 'win32' });
    const linux = makeEnv({ platform: 'linux' });
    expect(appConfigDir(mac)).toBe(join(mac.home, 'Library', 'Application Support'));
    expect(appConfigDir(win)).toBe(join(win.home, 'AppData', 'Roaming'));
    expect(appConfigDir(linux)).toBe(join(linux.home, '.config'));
  });

  it('xdgConfigDir prefers XDG_CONFIG_HOME', () => {
    const env = makeEnv({ env: { XDG_CONFIG_HOME: '/xdg' } });
    expect(xdgConfigDir(env)).toBe('/xdg');
  });
});
