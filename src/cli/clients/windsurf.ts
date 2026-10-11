/**
 * Windsurf (Cascade).
 *
 * Source: https://docs.devin.ai/desktop/cascade/mcp, the redirect target of
 * https://docs.windsurf.com/windsurf/cascade/mcp (accessed 2026-10-11).
 * - File: macOS/Linux `~/.config/devin/mcp_config.json` (`$XDG_CONFIG_HOME/devin/` when set),
 *   Windows `%APPDATA%\devin\mcp_config.json`; top-level `mcpServers`, entries
 *   `{ command, args?, env? }`. Only a user-level file is documented.
 * - Unverified: the older location `~/.codeium/windsurf/mcp_config.json` comes from the M2-03 task
 *   research; the current docs no longer mention it. It is used only when that file exists and
 *   the current one does not.
 * - Unverified: the docs do not say whether roots are advertised or which working directory
 *   servers get, and there is no workspace variable (see M2-02), so the entry is plain and setup
 *   prints a note.
 * - No documented CLI for adding servers.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './adapter.js';
import { xdgConfigDir } from './environment.js';
import { jsonCodec } from './json-codec.js';
import type { ClientAdapter, ClientEnvironment } from './types.js';
import { unverifiedProjectNote } from './unverified.js';

export function windsurf(env: ClientEnvironment): ClientAdapter {
  const configDir = env.platform === 'win32' ? env.env.APPDATA || join(env.home, 'AppData', 'Roaming') : xdgConfigDir(env);
  const current = join(configDir, 'devin', 'mcp_config.json');
  const legacyDir = join(env.home, '.codeium', 'windsurf');
  const legacy = join(legacyDir, 'mcp_config.json');
  return createClient(env, {
    id: 'windsurf',
    label: 'Windsurf',
    scopes: ['user'],
    codec: jsonCodec('mcpServers'),
    detect: () => env.findOnPath('windsurf') !== undefined || existsSync(current) || existsSync(legacyDir),
    path: () => (!existsSync(current) && existsSync(legacy) ? legacy : current),
    desired: (entry) => ({ value: { ...entry }, notes: [unverifiedProjectNote('Windsurf')] }),
  });
}
