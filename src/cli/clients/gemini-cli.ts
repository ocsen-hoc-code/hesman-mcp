/**
 * Gemini CLI.
 *
 * Source: https://geminicli.com/docs/tools/mcp-server/ (accessed 2026-10-11).
 * - Files: user `~/.gemini/settings.json`, project `.gemini/settings.json`; top-level `mcpServers`,
 *   entries `{ command, args?, env?, cwd?, timeout?, trust? }`.
 * - The client has its own CLI (`gemini mcp add [-s user|project] <name> <command> [args...]`,
 *   `gemini mcp remove <name>`). It is not used: the documented syntax has no `--` separator, so
 *   server arguments that start with a dash could be taken as its own options. The file is
 *   edited directly.
 * - Project selection: Gemini CLI advertises roots (see M2-02), so the entry is plain.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './adapter.js';
import { jsonCodec } from './json-codec.js';
import type { ClientAdapter, ClientEnvironment } from './types.js';

export function geminiCli(env: ClientEnvironment): ClientAdapter {
  const userFile = join(env.home, '.gemini', 'settings.json');
  return createClient(env, {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    kind: 'cli',
    scopes: ['user', 'project'],
    codec: jsonCodec('mcpServers'),
    detect: () => env.findOnPath('gemini') !== undefined || existsSync(userFile),
    path: (scope) => (scope === 'project' ? join(env.cwd, '.gemini', 'settings.json') : userFile),
    desired: (entry) => ({ value: { ...entry } }),
  });
}
