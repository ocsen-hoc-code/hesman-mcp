import { existsSync, readFileSync, rmSync } from 'node:fs';
import { backupPathFor, writeConfigAtomically } from '../config-writer.js';
import type { ConfigCodec, EntryValue } from './codec.js';
import type {
  ChangeOptions,
  ChangeResult,
  ClientAdapter,
  ClientEnvironment,
  ClientId,
  ClientKind,
  Scope,
  ServerEntry,
} from './types.js';

/** A client's own CLI for managing MCP servers. Return `undefined` when it cannot target the scope. */
export interface ClientCli {
  /** Executable name looked up on PATH. */
  bin: string;
  add(entry: ServerEntry, scope: Scope): string[] | undefined;
  remove(scope: Scope): string[] | undefined;
}

export interface ClientSpec {
  id: ClientId;
  label: string;
  kind: ClientKind;
  scopes: readonly Scope[];
  codec: ConfigCodec;
  detect(): boolean;
  path(scope: Scope): string;
  /** The value this client must store for `entry`, plus notes for the user. May throw. */
  desired(entry: ServerEntry, options: { scope: Scope; projectRoot?: string }): { value: EntryValue; notes?: string[] };
  cli?: ClientCli;
}

const readIfExists = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, 'utf-8') : undefined);

const quoteArg = (arg: string): string => (/^[\w@%+=:,./\\-]+$/.test(arg) ? arg : JSON.stringify(arg));
const commandLine = (bin: string, args: string[]): string => [bin, ...args].map(quoteArg).join(' ');

/**
 * Builds a {@link ClientAdapter} from a description of the client. The flow is the same for all
 * of them: compare with what is on disk, use the client's CLI when it is on PATH, otherwise edit
 * the file through the atomic writer (backup at `<config>.hesman.bak`).
 */
export function createClient(env: ClientEnvironment, spec: ClientSpec): ClientAdapter {
  const scopeOf = (options?: ChangeOptions): Scope => {
    const scope = options?.scope ?? 'user';
    if (!spec.scopes.includes(scope)) throw new Error(`${spec.label} has no ${scope} scope.`);
    return scope;
  };

  /** Runs CLI command lines in order; returns a note describing the first failure, if any. */
  const runCli = (binPath: string, commands: string[][], scope: Scope): string | undefined => {
    for (const args of commands) {
      const result = env.run(binPath, args, scope === 'project' ? { cwd: env.cwd } : undefined);
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout).trim() || `exit status ${result.status}`;
        return `\`${commandLine(spec.cli!.bin, args)}\` failed (${detail}); edited the config file instead.`;
      }
    }
    return undefined;
  };

  /** The CLI to use for these command lines, or undefined when the file must be edited. */
  const usableCli = (commands: (string[] | undefined)[]): { binPath: string; commands: string[][] } | undefined => {
    if (!spec.cli || commands.some((c) => c === undefined)) return undefined;
    const binPath = env.findOnPath(spec.cli.bin);
    if (!binPath) return undefined;
    const resolved = commands as string[][];
    // On Windows the CLI is started through a shell; never pass it anything that needs quoting.
    if (env.platform === 'win32' && resolved.flat().some((arg) => quoteArg(arg) !== arg)) return undefined;
    return { binPath, commands: resolved };
  };

  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    scopes: spec.scopes,
    detect: spec.detect,

    configPath: (scope = 'user') => spec.path(scope),

    read(scope = 'user') {
      if (!spec.scopes.includes(scope)) return undefined;
      const path = spec.path(scope);
      try {
        return spec.codec.read(readIfExists(path), path);
      } catch {
        return undefined;
      }
    },

    write(entry, options = {}): ChangeResult {
      const scope = scopeOf(options);
      const configPath = spec.path(scope);
      const { value, notes = [] } = spec.desired(entry, { scope, projectRoot: options.projectRoot });
      const text = readIfExists(configPath);
      const base = { client: spec.id, configPath, notes: [...notes] };
      const snippet = spec.codec.snippet(value);

      if (spec.codec.matches(text, value, configPath)) {
        return { ...base, status: 'unchanged', via: 'file', applied: false, preview: snippet };
      }
      const status = spec.codec.has(text, configPath) ? 'updated' : 'added';

      const launch: ServerEntry = { command: value.command, args: value.args };
      const cli = usableCli([
        ...(status === 'updated' ? [spec.cli?.remove(scope)] : []),
        spec.cli?.add(launch, scope),
      ]);
      if (cli) {
        const preview = cli.commands.map((args) => commandLine(spec.cli!.bin, args)).join('\n');
        if (options.dryRun) return { ...base, status, via: 'cli', applied: false, preview };
        const failure = runCli(cli.binPath, cli.commands, scope);
        if (!failure) return { ...base, status, via: 'cli', applied: true, preview };
        base.notes.push(failure);
      }

      // Re-read: a CLI that failed half-way may have changed the file.
      const content = spec.codec.apply(cli ? readIfExists(configPath) : text, value, configPath);
      if (options.dryRun) return { ...base, status, via: 'file', applied: false, preview: snippet };
      const { backupPath } = writeConfigAtomically(configPath, content);
      return { ...base, status, via: 'file', applied: true, backupPath, preview: snippet };
    },

    remove(options = {}): ChangeResult {
      const scope = scopeOf(options);
      const configPath = spec.path(scope);
      const text = readIfExists(configPath);
      const base = { client: spec.id, configPath, notes: [] as string[] };
      const current = text === undefined ? undefined : spec.codec.read(text, configPath);

      if (text === undefined || !spec.codec.has(text, configPath)) {
        return { ...base, status: 'absent', via: 'file', applied: false, preview: '' };
      }
      const snippet = current ? spec.codec.snippet(current) : '';

      const cli = usableCli([spec.cli?.remove(scope)]);
      if (cli) {
        const preview = cli.commands.map((args) => commandLine(spec.cli!.bin, args)).join('\n');
        if (options.dryRun) return { ...base, status: 'removed', via: 'cli', applied: false, preview };
        const failure = runCli(cli.binPath, cli.commands, scope);
        if (!failure) return { ...base, status: 'removed', via: 'cli', applied: true, preview };
        base.notes.push(failure);
      }
      if (options.dryRun) return { ...base, status: 'removed', via: 'file', applied: false, preview: snippet };

      // Exact undo first: if the backup plus our entry is what is on disk, put the backup back.
      const backupPath = backupPathFor(configPath);
      const backup = readIfExists(backupPath);
      let restored: string | undefined;
      try {
        if (backup !== undefined && spec.codec.restores(backup, text, configPath)) restored = backup;
      } catch {
        // An unreadable backup is simply not used.
      }

      if (restored === undefined && spec.codec.isOnlyHesman(text, configPath)) {
        // Hesman created this file; leave nothing behind.
        rmSync(configPath);
        return { ...base, status: 'removed', via: 'file', applied: true, preview: snippet };
      }
      const written = writeConfigAtomically(configPath, restored ?? spec.codec.strip(text, configPath));
      return { ...base, status: 'removed', via: 'file', applied: true, backupPath: written.backupPath, preview: snippet };
    },
  };
}
