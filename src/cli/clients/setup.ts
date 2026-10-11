import { splitArgs } from '../args.js';
import { serverEntry } from './entry.js';
import { allClients, isClientId } from './index.js';
import { CLIENT_IDS, type ChangeResult, type ClientAdapter, type ClientEnvironment, type ClientId, type Scope } from './types.js';

/** Terminal and machine access of the `setup` / `remove` / `install` commands; faked in tests. */
export interface CliIo {
  env: ClientEnvironment;
  out(line: string): void;
  /** True when a person can answer questions (stdin and stdout are terminals). */
  isTTY: boolean;
  /** Asks one question and resolves with the typed line. Only called when `isTTY`. */
  ask(question: string): Promise<string>;
}

/** Short names accepted for `--client`. "claude" is ambiguous on purpose (two clients). */
const ALIASES: Record<string, ClientId> = {
  gemini: 'gemini-cli',
  copilot: 'vscode',
  code: 'vscode',
  'codex-cli': 'codex',
};

const VALUE_FLAGS = ['--scope', '--project-root'];
const SETUP_FLAGS = ['--all', '--yes', '-y', '--dry-run'];

class UsageError extends Error {}

interface Options {
  /** Client ids named with `--client`, in the order given; empty when the flag was not used. */
  names: ClientId[];
  all: boolean;
  yes: boolean;
  dryRun: boolean;
  scope: Scope;
  projectRoot: string | undefined;
}

function parseOptions(args: readonly string[]): Options {
  // `--client` takes one or more names (`--client a b`, `--client a,b`, repeated), which
  // splitArgs cannot express, so those are taken out first.
  const rawNames: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--client') {
      while (i + 1 < args.length && !args[i + 1].startsWith('-')) rawNames.push(args[++i]);
    } else if (arg.startsWith('--client=')) {
      rawNames.push(arg.slice('--client='.length));
    } else {
      rest.push(arg);
    }
  }
  const usedClientFlag = rest.length !== args.length;

  const names: ClientId[] = [];
  for (const raw of rawNames.flatMap((n) => n.split(',')).map((n) => n.trim().toLowerCase()).filter(Boolean)) {
    const id = ALIASES[raw] ?? raw;
    if (raw === 'claude') throw new UsageError('"claude" is ambiguous: use claude-code (the CLI) or claude-desktop (the app).');
    if (!isClientId(id)) throw new UsageError(`Unknown client "${raw}". Supported: ${CLIENT_IDS.join(', ')}.`);
    if (!names.includes(id)) names.push(id);
  }
  if (usedClientFlag && names.length === 0) throw new UsageError(`--client needs a name. Supported: ${CLIENT_IDS.join(', ')}.`);

  const { positionals, flags, values } = splitArgs(rest, VALUE_FLAGS);
  const unknown = [...positionals, ...[...flags].filter((f) => !SETUP_FLAGS.includes(f) && !VALUE_FLAGS.includes(f))];
  if (unknown.length > 0) throw new UsageError(`Unknown argument: ${unknown.join(' ')}. See \`hesman --help\`.`);

  const scope = values.get('--scope') ?? (flags.has('--scope') ? '' : 'user');
  if (scope !== 'user' && scope !== 'project') throw new UsageError('--scope must be "user" or "project".');
  if (flags.has('--project-root')) throw new UsageError('--project-root needs a path.');

  return {
    names,
    all: flags.has('--all'),
    yes: flags.has('--yes') || flags.has('-y'),
    dryRun: flags.has('--dry-run'),
    scope,
    projectRoot: values.get('--project-root'),
  };
}

const title = (client: ClientAdapter): string => `${client.label} (${client.id})`;

function checklist(clients: ClientAdapter[], selected: ReadonlySet<ClientId>, detected: ReadonlySet<ClientId>): string[] {
  return clients.map((client, i) => {
    const box = selected.has(client.id) ? '[x]' : '[ ]';
    const hint = detected.has(client.id) ? '  — detected' : '';
    return `  ${box} ${String(i + 1).padStart(2)}. ${title(client)}${hint}`;
  });
}

/** Interactive checklist. Resolves with the chosen clients, or undefined when cancelled. */
async function choose(clients: ClientAdapter[], detected: ReadonlySet<ClientId>, io: CliIo): Promise<ClientAdapter[] | undefined> {
  const selected = new Set(detected);
  for (;;) {
    io.out('Clients to configure:');
    for (const line of checklist(clients, selected, detected)) io.out(line);
    const answer = (await io.ask('Numbers to toggle (e.g. "1 3"), a = all, n = none, q = cancel, Enter = apply: ')).trim().toLowerCase();

    if (answer === '') return clients.filter((c) => selected.has(c.id));
    if (answer === 'q') return undefined;
    if (answer === 'a') {
      for (const client of clients) selected.add(client.id);
      continue;
    }
    if (answer === 'n') {
      selected.clear();
      continue;
    }
    const numbers = answer.split(/[\s,]+/).map(Number);
    if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > clients.length)) {
      io.out(`Did not understand "${answer}".`);
      continue;
    }
    for (const n of numbers) {
      const id = clients[n - 1].id;
      if (!selected.delete(id)) selected.add(id);
    }
  }
}

const DRY_RUN_VERB: Record<ChangeResult['status'], string> = {
  added: 'would add',
  updated: 'would update',
  removed: 'would remove',
  unchanged: 'already configured',
  absent: 'not configured',
};
const APPLIED_VERB: Record<ChangeResult['status'], string> = {
  added: 'added',
  updated: 'updated',
  removed: 'removed',
  unchanged: 'already configured',
  absent: 'not configured',
};

function report(client: ClientAdapter, result: ChangeResult, dryRun: boolean, io: CliIo): void {
  const verb = (dryRun ? DRY_RUN_VERB : APPLIED_VERB)[result.status];
  const changes = result.status !== 'unchanged' && result.status !== 'absent';
  const through = changes && result.via === 'cli' ? ` (through the ${result.preview.split(' ')[0]} CLI)` : '';
  io.out(`${title(client)}: ${verb}${through}`);
  io.out(`  config: ${result.configPath}`);
  if (changes && result.preview) {
    const sign = result.status === 'removed' ? '-' : '+';
    const prefix = result.via === 'cli' ? '  $ ' : `  ${sign} `;
    for (const line of result.preview.split('\n')) io.out(prefix + line);
  }
  if (result.backupPath) io.out(`  backup: ${result.backupPath}`);
  for (const note of result.notes) io.out(`  note: ${note}`);
}

/** Runs `action` for each client; one failure never stops the rest. Returns the exit code. */
function forEachClient(
  clients: ClientAdapter[],
  options: Options,
  io: CliIo,
  action: (client: ClientAdapter) => ChangeResult,
): number {
  let failed = false;
  let applied = false;
  if (options.dryRun) io.out('Dry run: nothing is written and no command is run.');
  for (const client of clients) {
    io.out('');
    if (!client.scopes.includes(options.scope)) {
      io.out(`${title(client)}: skipped — it has no ${options.scope} scope`);
      continue;
    }
    try {
      const result = action(client);
      applied ||= result.applied;
      report(client, result, options.dryRun, io);
    } catch (err) {
      failed = true;
      io.out(`${title(client)}: failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (applied) {
    io.out('');
    io.out('Restart the client (or reload its MCP servers) for the change to take effect.');
  }
  return failed ? 1 : 0;
}

/** Parses options, printing the problem and returning undefined when they are invalid. */
function optionsOrComplain(args: readonly string[], io: CliIo): Options | undefined {
  try {
    return parseOptions(args);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.out(err.message);
    return undefined;
  }
}

/** `hesman setup`: add the Hesman server to the chosen clients. Resolves with the exit code. */
export async function runSetup(args: readonly string[], io: CliIo): Promise<number> {
  const options = optionsOrComplain(args, io);
  if (!options) return 1;

  const clients = allClients(io.env);
  const detected = new Set(clients.filter((c) => c.detect()).map((c) => c.id));
  const noneDetected = 'No supported client was detected. Choose with --client <name…> or --all.';

  let chosen: ClientAdapter[] | undefined;
  if (options.names.length > 0) {
    chosen = options.names.map((id) => clients.find((c) => c.id === id)!);
  } else if (options.all) {
    chosen = clients;
  } else if (options.yes || options.dryRun) {
    chosen = clients.filter((c) => detected.has(c.id));
    if (chosen.length === 0) {
      io.out(noneDetected);
      io.out(`Supported: ${CLIENT_IDS.join(', ')}.`);
      return options.dryRun ? 0 : 1;
    }
  } else if (io.isTTY) {
    chosen = await choose(clients, detected, io);
    if (!chosen) {
      io.out('Cancelled; nothing was changed.');
      return 1;
    }
    if (chosen.length === 0) {
      io.out('Nothing selected; nothing was changed.');
      return 1;
    }
  } else {
    // No terminal to ask on: say what was found and how to go on, never wait for input.
    io.out(detected.size > 0 ? 'Detected clients ([x]):' : noneDetected);
    for (const line of checklist(clients, detected, detected)) io.out(line);
    io.out('');
    io.out('Nothing was changed. Run one of:');
    io.out('  hesman setup --yes                 configure the detected clients');
    io.out('  hesman setup --client <name…>      configure specific clients');
    io.out('  hesman setup --all                 configure every supported client');
    io.out('  hesman setup --dry-run --all       show the changes without writing');
    return 1;
  }

  const entry = serverEntry();
  return forEachClient(chosen, options, io, (client) =>
    client.write(entry, { scope: options.scope, dryRun: options.dryRun, projectRoot: options.projectRoot }),
  );
}

/** `hesman remove`: take the Hesman server out of the clients again. Resolves with the exit code. */
export async function runRemove(args: readonly string[], io: CliIo): Promise<number> {
  const options = optionsOrComplain(args, io);
  if (!options) return 1;

  const clients = allClients(io.env);
  let chosen: ClientAdapter[];
  if (options.names.length > 0) {
    chosen = options.names.map((id) => clients.find((c) => c.id === id)!);
  } else if (options.all) {
    chosen = clients;
  } else {
    chosen = clients.filter((c) => c.read(options.scope) !== undefined);
    if (chosen.length === 0) {
      io.out(`Hesman is not configured in any client (${options.scope} scope).`);
      return 0;
    }
  }
  return forEachClient(chosen, options, io, (client) => client.remove({ scope: options.scope, dryRun: options.dryRun }));
}

/** `hesman install --agent X`: deprecated alias of `hesman setup --client X --yes`. */
export async function runInstall(args: readonly string[], io: CliIo): Promise<number> {
  const { values, flags } = splitArgs(args, ['--agent']);
  const agent = (values.get('--agent') ?? '').toLowerCase();
  if (!agent) {
    io.out('`hesman install` is deprecated. Use: hesman setup --client <name…> (see `hesman --help`).');
    return 1;
  }
  // Before M2-03 "claude" meant Claude Desktop; keep that meaning for the alias.
  const client = agent === 'claude' ? 'claude-desktop' : agent;
  io.out(`\`hesman install\` is deprecated and will be removed in the next minor version. Use: hesman setup --client ${client}`);
  if (flags.has('--global')) io.out('--global never had an effect and is ignored.');
  io.out('');
  return runSetup(['--client', client, '--yes'], io);
}
