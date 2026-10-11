import { antigravity } from './antigravity.js';
import { claudeCode } from './claude-code.js';
import { claudeDesktop } from './claude-desktop.js';
import { codex } from './codex.js';
import { cursor } from './cursor.js';
import { geminiCli } from './gemini-cli.js';
import { CLIENT_IDS, type ClientAdapter, type ClientEnvironment, type ClientId } from './types.js';
import { vscode } from './vscode.js';
import { windsurf } from './windsurf.js';

const FACTORIES: Record<ClientId, (env: ClientEnvironment) => ClientAdapter> = {
  'claude-code': claudeCode,
  'claude-desktop': claudeDesktop,
  codex,
  cursor,
  antigravity,
  vscode,
  'gemini-cli': geminiCli,
  windsurf,
};

export function getClient(id: ClientId, env: ClientEnvironment): ClientAdapter {
  return FACTORIES[id](env);
}

/** Every supported client, in display order. */
export function allClients(env: ClientEnvironment): ClientAdapter[] {
  return CLIENT_IDS.map((id) => getClient(id, env));
}

export function isClientId(value: string): value is ClientId {
  return (CLIENT_IDS as readonly string[]).includes(value);
}
