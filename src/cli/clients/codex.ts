/**
 * OpenAI Codex CLI.
 *
 * Source: https://learn.chatgpt.com/docs/extend/mcp?surface=cli and
 * https://learn.chatgpt.com/docs/config-file/config-reference, the redirect targets of
 * developers.openai.com/codex/* (accessed 2026-10-11).
 * - Preferred: `codex mcp add <server-name> [--env K=V] -- <stdio server-command>`.
 * - File: `~/.codex/config.toml` (the reference calls the directory `$CODEX_HOME`), one
 *   `[mcp_servers.<name>]` table per server with `command`, `args`, optional `cwd`, `env`,
 *   `enabled`. Project scope: `.codex/config.toml`, loaded only for trusted projects.
 * - Unverified: `codex mcp remove <name>` does not appear in the part of those pages that was
 *   read (they show `add`, `list`, `login`, `--help`). It is used anyway; when it fails, the
 *   adapter falls back to removing the table from the file.
 * - Project selection: Codex sends no roots but starts servers in the caller's working
 *   directory (see M2-02), so the entry is plain.
 * - TOML is edited as text by `toml-codec.ts` (no TOML dependency): only the hesman table is touched.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from './adapter.js';
import { SERVER_NAME } from './entry.js';
import { tomlCodec } from './toml-codec.js';
import type { ClientAdapter, ClientEnvironment } from './types.js';

export function codex(env: ClientEnvironment): ClientAdapter {
  const dir = env.env.CODEX_HOME || join(env.home, '.codex');
  return createClient(env, {
    id: 'codex',
    label: 'Codex CLI',
    scopes: ['user', 'project'],
    codec: tomlCodec(),
    detect: () => env.findOnPath('codex') !== undefined || existsSync(dir),
    path: (scope) => join(scope === 'project' ? join(env.cwd, '.codex') : dir, 'config.toml'),
    desired: (entry) => ({ value: { ...entry } }),
    cli: {
      bin: 'codex',
      // The CLI only writes the user-level config.
      add: (entry, scope) => (scope === 'user' ? ['mcp', 'add', SERVER_NAME, '--', entry.command, ...entry.args] : undefined),
      remove: (scope) => (scope === 'user' ? ['mcp', 'remove', SERVER_NAME] : undefined),
    },
  });
}
