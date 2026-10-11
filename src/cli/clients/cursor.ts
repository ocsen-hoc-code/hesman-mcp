/**
 * Cursor.
 *
 * Source: https://cursor.com/docs/context/mcp (accessed 2026-10-11).
 * - Files: global `~/.cursor/mcp.json`, project `.cursor/mcp.json`; top-level `mcpServers`,
 *   entries `{ command, args, env?, envFile? }`. The field table lists `type: "stdio"` as required
 *   but every stdio example on the page omits it; this adapter omits it too.
 * - Interpolation in `command`, `args`, `env`, `url`, `headers`: `${env:NAME}`, `${userHome}`,
 *   `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`.
 * - Project selection: the docs list MCP roots as supported, a forum report says `roots/list`
 *   was not answered (see M2-02), so the entry passes `--project-root ${workspaceFolder}`.
 * - Unverified: the docs define `${workspaceFolder}` as "the folder that contains
 *   `.cursor/mcp.json`". Whether it resolves to the open workspace or to the home directory when
 *   used in the GLOBAL `~/.cursor/mcp.json` is not stated and was not tested against a real Cursor.
 *   The user-scope note below tells the user to check.
 * - No documented CLI for adding servers.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './adapter.js';
import { jsonCodec } from './json-codec.js';
import type { ClientAdapter, ClientEnvironment } from './types.js';

export function cursor(env: ClientEnvironment): ClientAdapter {
  const dir = join(env.home, '.cursor');
  return createClient(env, {
    id: 'cursor',
    label: 'Cursor',
    scopes: ['user', 'project'],
    codec: jsonCodec('mcpServers'),
    detect: () => env.findOnPath('cursor') !== undefined || existsSync(dir),
    path: (scope) => join(scope === 'project' ? join(env.cwd, '.cursor') : dir, 'mcp.json'),
    desired: (entry, { scope }) => ({
      value: { command: entry.command, args: [...entry.args, '--project-root', '${workspaceFolder}'] },
      notes:
        scope === 'user'
          ? [
              'Cursor fills in ${workspaceFolder}. For the global config this is unverified: if Hesman indexes the wrong ' +
                'folder, run `hesman setup --client cursor --scope project` inside the project instead.',
            ]
          : [],
    }),
  });
}
