/**
 * Claude Desktop.
 *
 * Source: https://modelcontextprotocol.io/docs/develop/connect-local-servers (accessed 2026-10-11).
 * - File: `claude_desktop_config.json`, top-level `mcpServers`, entries `{ command, args, env? }`.
 *   macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`.
 * - Unverified: the page says Claude Desktop is available for Linux but gives no Linux path.
 *   This adapter uses `$XDG_CONFIG_HOME/Claude/` (default `~/.config/Claude/`), the usual
 *   location for an Electron app and what `hesman install` used before.
 * - Project selection: Claude Desktop has no workspace and passes no usable roots or working
 *   directory (see M2-02), so the entry pins one project with `--project-root <path>`.
 * - No CLI and no project scope.
 */
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createClient } from './adapter.js';
import { appConfigDir } from './environment.js';
import { jsonCodec } from './json-codec.js';
import type { ClientAdapter, ClientEnvironment } from './types.js';

export function claudeDesktop(env: ClientEnvironment): ClientAdapter {
  const dir = join(appConfigDir(env), 'Claude');
  return createClient(env, {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    kind: 'gui',
    scopes: ['user'],
    codec: jsonCodec('mcpServers'),
    detect: () => existsSync(dir),
    path: () => join(dir, 'claude_desktop_config.json'),
    desired: (entry, { projectRoot }) => {
      const project = resolve(env.cwd, projectRoot ?? '.');
      const home = resolve(env.home);
      if (home === project || home.startsWith(project.endsWith(sep) ? project : project + sep)) {
        throw new Error(
          `Claude Desktop needs one project to work on, and ${project} is the home directory or above it. ` +
            'Run the command inside a project or pass --project-root <path>.',
        );
      }
      return {
        value: { command: entry.command, args: [...entry.args, '--project-root', project] },
        notes: [
          `Claude Desktop has no workspace, so Hesman will always use ${project} there. ` +
            'Run `hesman setup --client claude-desktop --project-root <path>` to point it at another project.',
        ],
      };
    },
  });
}
