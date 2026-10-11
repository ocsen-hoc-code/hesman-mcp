/**
 * Cursor.
 *
 * Source: https://cursor.com/docs/context/mcp (accessed 2026-10-11).
 * - Files: global `~/.cursor/mcp.json`, project `.cursor/mcp.json`; top-level `mcpServers`,
 *   entries `{ command, args, env?, envFile? }`. The field table lists `type: "stdio"` as required
 *   but every stdio example on the page omits it; this adapter omits it too.
 * - Interpolation in `command`, `args`, `env`, `url`, `headers`: `${env:NAME}`, `${userHome}`,
 *   `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`.
 * - Project selection: the docs list MCP roots as supported, but a forum report says `roots/list`
 *   was not answered (see M2-02), so the PROJECT scope passes `--project-root ${workspaceFolder}`:
 *   there the variable is the project by definition ("the folder that contains `.cursor/mcp.json`").
 * - The USER scope writes the plain entry (M2-04). By the same definition `${workspaceFolder}` in
 *   the global `~/.cursor/mcp.json` may be the home directory, and an explicit `--project-root`
 *   always wins over roots and the working directory, so Hesman would index `~`. Without it the
 *   server uses MCP roots or its working directory, and the worst case is a clear `NO_PROJECT` error.
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
    kind: 'gui',
    scopes: ['user', 'project'],
    codec: jsonCodec('mcpServers'),
    detect: () => env.findOnPath('cursor') !== undefined || existsSync(dir),
    path: (scope) => join(scope === 'project' ? join(env.cwd, '.cursor') : dir, 'mcp.json'),
    desired: (entry, { scope }) =>
      scope === 'project'
        ? { value: { command: entry.command, args: [...entry.args, '--project-root', '${workspaceFolder}'] } }
        : {
            value: { command: entry.command, args: [...entry.args] },
            notes: [
              'The global Cursor entry does not name a project: Hesman uses the workspace folder Cursor reports. If its ' +
                'tools answer NO_PROJECT, run `hesman setup --client cursor --scope project` inside the project.',
            ],
          },
  });
}
