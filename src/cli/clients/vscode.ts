/**
 * VS Code (GitHub Copilot).
 *
 * Source: https://code.visualstudio.com/docs/copilot/reference/mcp-configuration and
 * https://code.visualstudio.com/docs/copilot/customization/mcp-servers (accessed 2026-10-11).
 * - Format: top-level `servers` (NOT `mcpServers`), stdio entries `{ type: "stdio", command, args }`
 *   with `type` required. Before M2-03 Hesman wrote `mcpServers` here, which VS Code ignores.
 * - Files: workspace `.vscode/mcp.json`; user-level `mcp.json` "in your user profile".
 * - Unverified: the docs give no on-disk path for the user-level file (they say to run
 *   "MCP: Open User Configuration"). This adapter uses the default profile's user directory:
 *   macOS `~/Library/Application Support/Code/User/`, Windows `%APPDATA%\Code\User\`,
 *   Linux `$XDG_CONFIG_HOME/Code/User/` (default `~/.config/Code/User/`). Insiders, VSCodium and
 *   non-default profiles keep theirs elsewhere and are not handled.
 * - `code --add-mcp '<json>'` exists, but no matching remove command is documented, so the file
 *   is edited directly.
 * - Project selection: VS Code advertises roots and starts servers in the workspace folder
 *   (see M2-02), so the entry is plain.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './adapter.js';
import { appConfigDir } from './environment.js';
import { jsonCodec } from './json-codec.js';
import type { ClientAdapter, ClientEnvironment } from './types.js';

export function vscode(env: ClientEnvironment): ClientAdapter {
  const userDir = join(appConfigDir(env), 'Code', 'User');
  return createClient(env, {
    id: 'vscode',
    label: 'VS Code (Copilot)',
    kind: 'gui',
    scopes: ['user', 'project'],
    codec: jsonCodec('servers'),
    detect: () => env.findOnPath('code') !== undefined || existsSync(userDir),
    path: (scope) => join(scope === 'project' ? join(env.cwd, '.vscode') : userDir, 'mcp.json'),
    desired: (entry) => ({ value: { type: 'stdio', ...entry } }),
  });
}
