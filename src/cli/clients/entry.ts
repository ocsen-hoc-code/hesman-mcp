import type { ClientAdapter, ClientEnvironment, Installation, ServerEntry } from './types.js';

/** Name of the server entry in every client config. */
export const SERVER_NAME = 'hesman';

/** npm package name; `npx` entries are pinned to its major version. */
export const PACKAGE_NAME = 'hesman-mcp';

/** Values of `hesman setup --command`. */
export const COMMAND_MODES = ['auto', 'npx', 'global', 'absolute'] as const;
export type CommandMode = (typeof COMMAND_MODES)[number];

/**
 * The three ways a client can start Hesman:
 * - `npx`: `npx -y hesman-mcp@<major>` — no install needed, survives Node upgrades, needs the
 *   package on the npm registry.
 * - `global`: `hesman` — needs a global install on the PATH the client sees.
 * - `absolute`: `<node binary> <entry script>` — needs no PATH at all, breaks when either moves.
 */
export type LaunchKind = Exclude<CommandMode, 'auto'>;

/**
 * The command a client is told to launch. This is the single place that builds it: each adapter
 * derives its config entry from the value returned here.
 */
export function serverEntry(kind: LaunchKind, installation: Installation): ServerEntry {
  switch (kind) {
    case 'npx':
      return { command: 'npx', args: ['-y', `${PACKAGE_NAME}@${installation.version.split('.')[0]}`] };
    case 'global':
      return { command: SERVER_NAME, args: [] };
    case 'absolute':
      return { command: installation.execPath, args: [installation.entryScript] };
  }
}

const segments = (path: string): string[] => path.split(/[\\/]+/);

/** True when this Hesman was started by `npx`: npm keeps those packages under `<npm cache>/_npx/`. */
export function runsFromNpxCache(env: ClientEnvironment): boolean {
  return segments(env.installation.entryScript).includes('_npx');
}

/** True when `binPath` (the `hesman` found on PATH) starts this very installation. */
function isThisInstallation(binPath: string, env: ClientEnvironment): boolean {
  const script = env.realpath(env.installation.entryScript);
  // POSIX: npm links `<prefix>/bin/hesman` to the entry script.
  if (env.realpath(binPath) === script) return true;
  // Windows: npm writes shims (`<prefix>\hesman.cmd`) next to `<prefix>\node_modules\<package>\`.
  if (env.platform !== 'win32') return false;
  const shimDir = segments(env.realpath(binPath)).slice(0, -1);
  const expected = [...shimDir, 'node_modules', PACKAGE_NAME];
  const actual = segments(script);
  return expected.every((part, i) => actual[i]?.toLowerCase() === part.toLowerCase());
}

/**
 * `--command auto`: pick the launch kind from how the running Hesman was started. Uses only local
 * facts, never the network:
 * 1. it runs from an npx cache directory (`…/_npx/…`) → `npx` (the package was just fetched that
 *    way, so it is published and `npx` works for the user);
 * 2. `hesman` on PATH resolves, through symbolic links, to this installation → `global`;
 * 3. otherwise (source checkout, local `node_modules`, a link that is not on PATH, another
 *    installation on PATH) → `absolute`, the only form that is known to start this code.
 */
export function autoLaunch(env: ClientEnvironment): { kind: LaunchKind; reason: string } {
  if (runsFromNpxCache(env)) return { kind: 'npx', reason: 'Hesman was started through npx' };
  const onPath = env.findOnPath(SERVER_NAME);
  if (onPath === undefined) return { kind: 'absolute', reason: '`hesman` is not on PATH' };
  if (isThisInstallation(onPath, env)) return { kind: 'global', reason: `\`hesman\` on PATH (${onPath}) is this installation` };
  return { kind: 'absolute', reason: `\`hesman\` on PATH (${onPath}) is a different installation` };
}

/**
 * Directories a desktop app can be expected to search even when it was opened from the Dock or a
 * launcher and therefore never read the shell profile. Version managers (nvm, fnm, volta, asdf,
 * mise, n with a custom prefix) install elsewhere.
 */
const GUI_PATH_DIRS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/opt/homebrew/bin'],
  linux: ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/snap/bin'],
};

/**
 * Whether a desktop app will find `command` without the user's shell PATH. The rule:
 * - Windows: the command is on PATH (desktop apps and shells share the PATH from the registry).
 * - macOS / Linux: the first `command` on PATH **and** the first `node` on PATH (both `npx` and
 *   `hesman` are `#!/usr/bin/env node` scripts) are in one of {@link GUI_PATH_DIRS}. The directory
 *   is the one listed on PATH, not the link target, because that is what the app searches.
 */
export function resolvableByGuiApps(command: string, env: ClientEnvironment): boolean {
  const dirs = env.platform === 'win32' ? undefined : (GUI_PATH_DIRS[env.platform] ?? GUI_PATH_DIRS.linux!);
  return [command, ...(dirs ? ['node'] : [])].every((name) => {
    const found = env.findOnPath(name);
    if (found === undefined) return false;
    return dirs === undefined || dirs.includes(found.slice(0, found.lastIndexOf('/')));
  });
}

export interface Launch {
  kind: LaunchKind;
  entry: ServerEntry;
  /** Per-client remarks: why the entry differs from the chosen command, or why it may not start. */
  notes: string[];
}

/**
 * The entry for one client. Terminal clients (`cli`) inherit the shell PATH and always get the
 * chosen command. Desktop apps (`gui`) get it only when {@link resolvableByGuiApps} says they can
 * find it; otherwise `auto` switches that client to absolute paths, while an explicit `--command`
 * is kept as asked and only warned about.
 */
export function launchFor(client: Pick<ClientAdapter, 'id' | 'label' | 'kind'>, mode: CommandMode, env: ClientEnvironment): Launch {
  const kind = mode === 'auto' ? autoLaunch(env).kind : mode;
  const entry = serverEntry(kind, env.installation);
  if (kind === 'absolute' || client.kind === 'cli' || resolvableByGuiApps(entry.command, env)) {
    return { kind, entry, notes: [] };
  }

  const found = env.findOnPath(entry.command);
  const where = found ? `is at ${found}` : 'is not on PATH';
  if (mode !== 'auto') {
    return {
      kind,
      entry,
      notes: [
        `${client.label} is a desktop app and may not find \`${entry.command}\`: it ${where}, outside the standard system ` +
          `directories. If the server does not start, run \`hesman setup --client ${client.id} --command absolute\`.`,
      ],
    };
  }
  return {
    kind: 'absolute',
    entry: serverEntry('absolute', env.installation),
    notes: [
      `${client.label} is a desktop app that does not get your shell PATH, and \`${entry.command}\` ${where}, outside the ` +
        'standard system directories, so this entry uses absolute paths instead. Run `hesman setup` again after switching Node versions.',
    ],
  };
}
