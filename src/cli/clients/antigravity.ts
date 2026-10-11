/**
 * Google Antigravity.
 *
 * Source: https://antigravity.google/docs/mcp (accessed 2026-10-11).
 * - Files: global `~/.gemini/config/mcp_config.json`, workspace `.agents/mcp_config.json`;
 *   top-level `mcpServers`, stdio entries `{ command, args?, env?, cwd? }`.
 * - Unverified: the legacy location `~/.gemini/antigravity/mcp_config.json` (Antigravity before
 *   2.0) comes from the M2-03 task research; the current docs do not mention it. It is used only
 *   when that file exists and the current one does not.
 * - Unverified: the docs do not say whether roots are advertised or which working directory
 *   servers get (see M2-02), so the entry is plain and setup prints a note.
 * - No documented CLI for adding servers.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './adapter.js';
import { jsonCodec } from './json-codec.js';
import type { ClientAdapter, ClientEnvironment } from './types.js';
import { unverifiedProjectNote } from './unverified.js';

export function antigravity(env: ClientEnvironment): ClientAdapter {
  const current = join(env.home, '.gemini', 'config', 'mcp_config.json');
  const legacyDir = join(env.home, '.gemini', 'antigravity');
  const legacy = join(legacyDir, 'mcp_config.json');
  return createClient(env, {
    id: 'antigravity',
    label: 'Antigravity',
    scopes: ['user', 'project'],
    codec: jsonCodec('mcpServers'),
    detect: () => env.findOnPath('antigravity') !== undefined || existsSync(current) || existsSync(legacyDir),
    path: (scope) => {
      if (scope === 'project') return join(env.cwd, '.agents', 'mcp_config.json');
      return !existsSync(current) && existsSync(legacy) ? legacy : current;
    },
    desired: (entry) => ({ value: { ...entry }, notes: [unverifiedProjectNote('Antigravity')] }),
  });
}
