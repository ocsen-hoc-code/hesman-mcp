/**
 * Claude Code (CLI).
 *
 * Source: https://code.claude.com/docs/en/mcp and https://code.claude.com/docs/en/env-vars
 * (accessed 2026-10-11).
 * - Preferred: `claude mcp add [options] <name> -- <command> [args...]`, `--scope local|project|user`
 *   (options go before the name, everything after `--` is the server command);
 *   `claude mcp remove <name> --scope <scope>`.
 * - Files: user scope in `~/.claude.json` (top-level `mcpServers`), project scope in `.mcp.json`
 *   at the project root. Entries carry `"type": "stdio"`; an entry without `type` is read as stdio.
 * - Project selection: Claude Code advertises MCP roots (see M2-02), so the entry is plain.
 * - Unverified: the docs say `CLAUDE_CONFIG_DIR` overrides the configuration directory
 *   (`~/.claude`) but do not state where `.claude.json` goes then. This adapter assumes
 *   `$CLAUDE_CONFIG_DIR/.claude.json`; with the CLI on PATH the file is not edited at all.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './adapter.js';
import { SERVER_NAME } from './entry.js';
import { jsonCodec } from './json-codec.js';
import type { ClientAdapter, ClientEnvironment } from './types.js';

export function claudeCode(env: ClientEnvironment): ClientAdapter {
  const configDir = env.env.CLAUDE_CONFIG_DIR;
  const userFile = join(configDir || env.home, '.claude.json');
  return createClient(env, {
    id: 'claude-code',
    label: 'Claude Code',
    kind: 'cli',
    scopes: ['user', 'project'],
    codec: jsonCodec('mcpServers'),
    detect: () =>
      env.findOnPath('claude') !== undefined || existsSync(configDir || join(env.home, '.claude')) || existsSync(userFile),
    path: (scope) => (scope === 'project' ? join(env.cwd, '.mcp.json') : userFile),
    desired: (entry) => ({ value: { type: 'stdio', ...entry } }),
    cli: {
      bin: 'claude',
      add: (entry, scope) => ['mcp', 'add', '--scope', scope, SERVER_NAME, '--', entry.command, ...entry.args],
      remove: (scope) => ['mcp', 'remove', SERVER_NAME, '--scope', scope],
    },
  });
}
