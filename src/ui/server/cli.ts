import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { HesmanConfig } from '../../config/schema.js';
import { CONFIG_VALUE_FLAGS, splitArgs } from '../../cli/args.js';
import { UiStartError, startUiServer, type UiServer } from './server.js';

/**
 * `hesman ui [path] [--port <n>] [--no-open]`: argument handling and terminal
 * output of the dashboard command. The server itself is `server.ts`.
 */

export interface UiCommandIo {
  out(line: string): void;
  err(line: string): void;
  /** Opens a URL in the user's browser; failures are ignored. */
  openBrowser(url: string): void;
}

export interface ParsedUiArgs {
  /** The project path given on the command line, if any. */
  path: string | undefined;
  /** 0 = pick a free port. */
  port: number;
  open: boolean;
}

/** @throws Error with a message for the terminal when an argument is invalid. */
export function parseUiArgs(args: readonly string[]): ParsedUiArgs {
  const { positionals, flags, values } = splitArgs(args, [...CONFIG_VALUE_FLAGS, '--port']);
  let port = 0;
  const rawPort = values.get('--port');
  // `splitArgs` drops a value flag that has no value.
  if (rawPort === undefined && args.includes('--port')) {
    throw new Error('--port needs a value: a port number between 0 and 65535');
  }
  if (rawPort !== undefined) {
    if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) > 65535) {
      throw new Error(`Invalid --port "${rawPort}": expected a number between 0 and 65535`);
    }
    port = Number(rawPort);
  }
  return { path: positionals[0], port, open: !flags.has('--no-open') };
}

/** Starts the platform's "open this URL" command, detached. Never throws. */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [command, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser opener on this machine: the URL is printed anyway.
  }
}

/**
 * Starts the dashboard for the project and prints its URL. Returns the running
 * server, or `null` after printing why it could not start (exit code 1).
 */
export async function runUiCommand(args: readonly string[], config: HesmanConfig, io: UiCommandIo): Promise<UiServer | null> {
  let parsed: ParsedUiArgs;
  try {
    parsed = parseUiArgs(args);
  } catch (err) {
    io.err((err as Error).message);
    return null;
  }

  const projectRoot = resolve(parsed.path || config.projectRoot);
  const dataDir = resolve(projectRoot, config.dataDir);

  let server: UiServer;
  try {
    server = await startUiServer({ projectRoot, dataDir, config, port: parsed.port });
  } catch (err) {
    if (!(err instanceof UiStartError)) throw err;
    io.err(err.message);
    return null;
  }

  io.out(`Hesman dashboard for ${projectRoot}`);
  io.out('');
  io.out(`  ${server.url}`);
  io.out('');
  io.out('Only this machine can reach it (127.0.0.1), and only with the token in the URL.');
  io.out('The index is opened read-only, so an MCP server for this project can keep running.');
  io.out('Not available here: semantic_search and live indexing progress (both belong to the MCP server).');
  io.out('Press Ctrl+C to stop.');
  if (parsed.open) io.openBrowser(server.url);
  return server;
}
