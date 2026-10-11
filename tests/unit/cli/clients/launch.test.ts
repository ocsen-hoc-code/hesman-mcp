import { describe, it, expect, afterEach } from 'vitest';
import { autoLaunch, launchFor, resolvableByGuiApps, serverEntry } from '../../../../src/cli/clients/entry';
import { getClient } from '../../../../src/cli/clients/index';
import { FAKE_INSTALLATION, cleanupEnvs, makeEnv } from './helpers';

afterEach(cleanupEnvs);

const ABSOLUTE = { command: FAKE_INSTALLATION.execPath, args: [FAKE_INSTALLATION.entryScript] };
const NPX = { command: 'npx', args: ['-y', 'hesman-mcp@1'] };
const GLOBAL = { command: 'hesman', args: [] };

const NPX_CACHE_SCRIPT = '/fake/home/.npm/_npx/0a1b2c3d/node_modules/hesman-mcp/dist/index.js';
const NVM_BIN = '/fake/home/.nvm/versions/node/v22.11.0/bin';
const GLOBAL_SCRIPT = `${NVM_BIN}/../lib/node_modules/hesman-mcp/dist/index.js`;

describe('serverEntry()', () => {
  it('npx pins the major of the running package version', () => {
    expect(serverEntry('npx', { ...FAKE_INSTALLATION, version: '3.7.1' })).toEqual({ command: 'npx', args: ['-y', 'hesman-mcp@3'] });
  });

  it('global is the bare `hesman` command', () => {
    expect(serverEntry('global', FAKE_INSTALLATION)).toEqual(GLOBAL);
  });

  it('absolute is the running node binary plus the installed entry script', () => {
    expect(serverEntry('absolute', FAKE_INSTALLATION)).toEqual(ABSOLUTE);
  });
});

describe('autoLaunch()', () => {
  it('picks npx when Hesman runs from an npx cache directory', () => {
    const env = makeEnv({ installation: { entryScript: NPX_CACHE_SCRIPT } });
    expect(autoLaunch(env).kind).toBe('npx');
  });

  it('picks npx from a Windows npx cache path too', () => {
    const env = makeEnv({
      platform: 'win32',
      installation: { entryScript: 'C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\0a1b\\node_modules\\hesman-mcp\\dist\\index.js' },
    });
    expect(autoLaunch(env).kind).toBe('npx');
  });

  it('picks global when `hesman` on PATH is a link to the running entry script', () => {
    const env = makeEnv({
      pathOf: { hesman: `${NVM_BIN}/hesman` },
      links: { [`${NVM_BIN}/hesman`]: '/real/lib/node_modules/hesman-mcp/dist/index.js', [GLOBAL_SCRIPT]: '/real/lib/node_modules/hesman-mcp/dist/index.js' },
      installation: { entryScript: GLOBAL_SCRIPT },
    });
    expect(autoLaunch(env).kind).toBe('global');
  });

  it('picks absolute when `hesman` on PATH belongs to another installation', () => {
    const env = makeEnv({
      pathOf: { hesman: '/usr/local/bin/hesman' },
      links: { '/usr/local/bin/hesman': '/usr/local/lib/node_modules/hesman-mcp/dist/index.js' },
    });
    expect(autoLaunch(env).kind).toBe('absolute');
  });

  it('picks absolute when `hesman` is not on PATH (source checkout, local install)', () => {
    expect(autoLaunch(makeEnv()).kind).toBe('absolute');
  });

  it('picks global on Windows when the `hesman` shim sits next to the node_modules holding this installation', () => {
    const env = makeEnv({
      platform: 'win32',
      pathOf: { hesman: '/fake/npm/hesman.cmd' },
      installation: { entryScript: '/fake/npm/node_modules/hesman-mcp/dist/index.js' },
    });
    expect(autoLaunch(env).kind).toBe('global');
  });

  it('explains the choice', () => {
    expect(autoLaunch(makeEnv()).reason).toMatch(/not on PATH|PATH/);
  });
});

describe('resolvableByGuiApps()', () => {
  it.each([
    ['darwin', '/opt/homebrew/bin'],
    ['darwin', '/usr/local/bin'],
    ['darwin', '/usr/bin'],
    ['linux', '/usr/bin'],
    ['linux', '/usr/local/bin'],
  ] as const)('on %s a command in %s (with node beside it) is resolvable', (platform, dir) => {
    const env = makeEnv({ platform, pathOf: { npx: `${dir}/npx`, node: `${dir}/node` } });
    expect(resolvableByGuiApps('npx', env)).toBe(true);
  });

  it.each([
    ['nvm', '/fake/home/.nvm/versions/node/v22.11.0/bin'],
    ['fnm', '/fake/home/.local/state/fnm_multishells/123/bin'],
    ['volta', '/fake/home/.volta/bin'],
    ['asdf', '/fake/home/.asdf/shims'],
  ])('a command installed through %s is not resolvable on macOS', (_manager, dir) => {
    const env = makeEnv({ platform: 'darwin', pathOf: { npx: `${dir}/npx`, node: `${dir}/node` } });
    expect(resolvableByGuiApps('npx', env)).toBe(false);
  });

  it('is not resolvable when the command is in a standard directory but node is not', () => {
    const env = makeEnv({ platform: 'darwin', pathOf: { hesman: '/usr/local/bin/hesman', node: `${NVM_BIN}/node` } });
    expect(resolvableByGuiApps('hesman', env)).toBe(false);
  });

  it('is not resolvable when the command is not on PATH at all', () => {
    expect(resolvableByGuiApps('npx', makeEnv({ platform: 'darwin' }))).toBe(false);
  });

  it('on Windows anything on PATH is resolvable (desktop apps get the same PATH as shells)', () => {
    const env = makeEnv({ platform: 'win32', pathOf: { npx: 'C:\\nvm4w\\nodejs\\npx.cmd' } });
    expect(resolvableByGuiApps('npx', env)).toBe(true);
    expect(resolvableByGuiApps('hesman', env)).toBe(false);
  });
});

describe('launchFor()', () => {
  const nvmNpx = (platform: NodeJS.Platform = 'darwin') =>
    makeEnv({
      platform,
      pathOf: { npx: `${NVM_BIN}/npx`, node: `${NVM_BIN}/node` },
      installation: { entryScript: NPX_CACHE_SCRIPT },
    });
  const absoluteOfNpxRun = { command: FAKE_INSTALLATION.execPath, args: [NPX_CACHE_SCRIPT] };

  it.each(['claude-code', 'codex', 'gemini-cli'] as const)('auto keeps npx for the terminal client %s under nvm', (id) => {
    const env = nvmNpx();
    const launch = launchFor(getClient(id, env), 'auto', env);
    expect(launch.entry).toEqual(NPX);
    expect(launch.notes).toEqual([]);
  });

  it.each(['claude-desktop', 'cursor', 'antigravity', 'vscode', 'windsurf'] as const)(
    'auto falls back to absolute paths for the desktop app %s under nvm and warns about Node upgrades',
    (id) => {
      const env = nvmNpx();
      const launch = launchFor(getClient(id, env), 'auto', env);
      expect(launch.kind).toBe('absolute');
      expect(launch.entry).toEqual(absoluteOfNpxRun);
      expect(launch.notes.join('\n')).toMatch(/hesman setup.*again after switching Node versions/s);
      expect(launch.notes.join('\n')).toContain(`${NVM_BIN}/npx`);
    },
  );

  it('auto keeps npx for a desktop app when npx and node are in a standard system directory', () => {
    const env = makeEnv({
      platform: 'darwin',
      pathOf: { npx: '/opt/homebrew/bin/npx', node: '/opt/homebrew/bin/node' },
      installation: { entryScript: NPX_CACHE_SCRIPT },
    });
    const launch = launchFor(getClient('claude-desktop', env), 'auto', env);
    expect(launch.entry).toEqual(NPX);
    expect(launch.notes).toEqual([]);
  });

  it('auto falls back to absolute for a desktop app when the global `hesman` lives in an nvm directory', () => {
    const env = makeEnv({
      platform: 'darwin',
      pathOf: { hesman: `${NVM_BIN}/hesman`, node: `${NVM_BIN}/node` },
      links: { [`${NVM_BIN}/hesman`]: GLOBAL_SCRIPT },
      installation: { entryScript: GLOBAL_SCRIPT },
    });
    expect(launchFor(getClient('claude-code', env), 'auto', env).entry).toEqual(GLOBAL);
    expect(launchFor(getClient('cursor', env), 'auto', env).entry).toEqual({ command: FAKE_INSTALLATION.execPath, args: [GLOBAL_SCRIPT] });
  });

  it('auto that already resolves to absolute adds no per-client note', () => {
    const env = makeEnv({ platform: 'darwin' });
    const launch = launchFor(getClient('claude-desktop', env), 'auto', env);
    expect(launch.entry).toEqual(ABSOLUTE);
    expect(launch.notes).toEqual([]);
  });

  it('an explicit --command is never replaced: a desktop app keeps npx and gets a warning instead', () => {
    const env = nvmNpx();
    const launch = launchFor(getClient('claude-desktop', env), 'npx', env);
    expect(launch.entry).toEqual(NPX);
    expect(launch.notes.join('\n')).toMatch(/may not find `npx`/);
    expect(launch.notes.join('\n')).toMatch(/--command absolute/);
  });

  it('an explicit --command global for a terminal client is written as is, without notes', () => {
    const env = makeEnv({ platform: 'darwin' });
    const launch = launchFor(getClient('codex', env), 'global', env);
    expect(launch.entry).toEqual(GLOBAL);
    expect(launch.notes).toEqual([]);
  });

  it('an explicit --command absolute is the same for every client', () => {
    const env = nvmNpx();
    for (const id of ['claude-code', 'claude-desktop'] as const) {
      expect(launchFor(getClient(id, env), 'absolute', env).entry).toEqual(absoluteOfNpxRun);
    }
  });
});
