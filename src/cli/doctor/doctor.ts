import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { splitArgs } from '../args.js';
import { PACKAGE_NAME, SERVER_NAME, launchFor, resolvableByGuiApps, runsFromNpxCache } from '../clients/entry.js';
import { allClients, isClientId } from '../clients/index.js';
import { CLIENT_IDS, type ClientAdapter, type ClientEnvironment, type ClientId, type ServerEntry } from '../clients/types.js';
import type { Check, CheckStatus, ClientReport, DoctorEnvironment, DoctorReport, ProbeResult } from './types.js';

/** Terminal and machine access of `hesman doctor`; a subset of the `CliIo` of `hesman setup`. */
export interface DoctorIo {
  env: ClientEnvironment;
  out(line: string): void;
}

/** Limit for the `initialize` answer unless `--timeout` says otherwise. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000;
/** The registry lookup is a courtesy: short, and never a failure when it cannot be made. */
const REGISTRY_TIMEOUT_MS = 2000;
/** Day on which `hesman-mcp` was last known not to be on the npm registry. */
const NOT_PUBLISHED_AS_OF = '2026-10-11';

/** Short names accepted for `--client`; the same as `hesman setup`. */
const ALIASES: Record<string, ClientId> = {
  gemini: 'gemini-cli',
  copilot: 'vscode',
  code: 'vscode',
  'codex-cli': 'codex',
};

class UsageError extends Error {}

interface Options {
  names: ClientId[];
  json: boolean;
  timeoutMs: number;
}

function parseOptions(args: readonly string[]): Options {
  // `--client` takes one or more names (`--client a b`, `--client a,b`, repeated).
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

  const { positionals, flags, values } = splitArgs(rest, ['--timeout']);
  const unknown = [...positionals, ...[...flags].filter((f) => f !== '--json' && f !== '--timeout')];
  if (unknown.length > 0) throw new UsageError(`Unknown argument: ${unknown.join(' ')}. See \`hesman --help\`.`);

  let timeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS;
  if (rest.some((a) => a === '--timeout' || a.startsWith('--timeout='))) {
    timeoutMs = Number(values.get('--timeout'));
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new UsageError('--timeout needs a whole number of milliseconds, e.g. --timeout 10000.');
  }
  return { names, json: flags.has('--json'), timeoutMs };
}

// ── This installation ────────────────────────────────────────────────────

/** True / false for a `>=x.y.z` range, undefined for any other range syntax. */
function satisfiesMinimum(version: string, range: string): boolean | undefined {
  const match = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range);
  if (!match) return undefined;
  const minimum = match.slice(1).map((part) => Number(part ?? 0));
  const actual = version.replace(/^v/, '').split('.').map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((actual[i] ?? 0) !== minimum[i]) return (actual[i] ?? 0) > minimum[i];
  }
  return true;
}

function serverChecks(env: ClientEnvironment, machine: DoctorEnvironment): Check[] {
  const script = env.installation.entryScript;
  const entryScript: Check = machine.exists(script)
    ? { id: 'entry-script', status: 'pass', message: `The server entry script exists: ${script}` }
    : {
        id: 'entry-script',
        status: 'fail',
        message: `The server entry script ${script} does not exist, so no client can start this installation.`,
        fix: 'In a source checkout run `npm run build`; otherwise reinstall hesman-mcp.',
      };

  const satisfied = satisfiesMinimum(machine.nodeVersion, machine.enginesNode);
  const nodeFacts = { version: machine.nodeVersion, required: machine.enginesNode };
  const node: Check =
    satisfied === undefined
      ? { id: 'node', status: 'warn', message: `Node ${machine.nodeVersion}; doctor cannot evaluate the required range "${machine.enginesNode}".`, details: nodeFacts }
      : satisfied
        ? { id: 'node', status: 'pass', message: `Node ${machine.nodeVersion} satisfies the required ${machine.enginesNode}.`, details: nodeFacts }
        : {
            id: 'node',
            status: 'fail',
            message: `Node ${machine.nodeVersion} does not satisfy the required ${machine.enginesNode}.`,
            fix: `Switch to a Node version matching ${machine.enginesNode}, then run \`hesman setup\` again so the clients use it.`,
            details: nodeFacts,
          };

  const missing = machine.grammars.filter((grammar) => !machine.exists(join(machine.parsersDir, grammar)));
  const parsers: Check =
    missing.length === 0
      ? { id: 'parsers', status: 'pass', message: `All ${machine.grammars.length} bundled parsers are present in ${machine.parsersDir}.` }
      : {
          id: 'parsers',
          status: 'fail',
          message: `Missing in ${machine.parsersDir}: ${missing.join(', ')}. Files of those languages will not be parsed.`,
          fix: 'In a source checkout run `npx tsx scripts/download-parsers.ts`; otherwise reinstall hesman-mcp.',
          details: { missing },
        };

  return [entryScript, node, parsers];
}

// ── One client ───────────────────────────────────────────────────────────

const isAbsolutePath = (path: string): boolean => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
const quote = (arg: string): string => (/^[\w@%+=:,./\\-]+$/.test(arg) ? arg : JSON.stringify(arg));
const commandLine = (entry: ServerEntry): string => [entry.command, ...entry.args].map(quote).join(' ');
const clip = (text: string, max = 160): string => (text.length > max ? `${text.slice(0, max)}…` : text);
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface PinnedRoot {
  value: string;
  /** The arguments that pin it: `['--project-root', value]` or `['--project-root=value']`. */
  args: string[];
  /** The entry's arguments without them. */
  rest: string[];
}

/** The `--project-root` of an entry, if it has one. */
function pinnedRoot(args: readonly string[]): PinnedRoot | undefined {
  const i = args.findIndex((arg) => arg === '--project-root' || arg.startsWith('--project-root='));
  if (i === -1) return undefined;
  const width = args[i] === '--project-root' ? 2 : 1;
  if (i + width > args.length) return undefined;
  const value = width === 2 ? args[i + 1] : args[i].slice('--project-root='.length);
  return { value, args: args.slice(i, i + width), rest: [...args.slice(0, i), ...args.slice(i + width)] };
}

/** A variable only the client can expand, e.g. Cursor's `${workspaceFolder}`. */
const hasClientVariable = (value: string): boolean => value.includes('${');

/**
 * The `cwd` of the `hesman` entry in this config text, if it still has one (written before M2-03).
 * The adapters do not expose it, and a client that honours it starts the server there.
 */
function entryCwd(text: string): string | undefined {
  try {
    const doc = JSON.parse(text) as Record<string, Record<string, unknown> | undefined>;
    for (const key of ['mcpServers', 'servers']) {
      const entry = doc[key]?.[SERVER_NAME];
      if (typeof entry === 'object' && entry !== null && 'cwd' in entry) return String((entry as { cwd: unknown }).cwd);
    }
    return undefined;
  } catch {
    // Not JSON: Codex `config.toml`. Look inside the `[mcp_servers.hesman]` table only.
    let inTable = false;
    for (const line of text.split(/\r?\n/)) {
      const header = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line);
      if (header) {
        inTable = header[1].replace(/["'\s]/g, '') === `mcp_servers.${SERVER_NAME}`;
        continue;
      }
      const cwd = inTable ? /^\s*cwd\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(line) : null;
      if (cwd) return cwd[2] ?? (JSON.parse(`"${cwd[1]}"`) as string);
    }
    return undefined;
  }
}

/**
 * What doctor knows about how each client tells the server which project is open. Taken from the
 * adapters' source notes (M2-02 / M2-03); "unverified" means no documentation or test confirms it.
 */
const PROJECT_FACTS: Partial<Record<ClientId, string>> = {
  'claude-code': 'Claude Code reports the open folder through MCP roots, so its project does not depend on the directory tested here.',
  'gemini-cli': 'Gemini CLI reports the open folder through MCP roots, so its project does not depend on the directory tested here.',
  vscode: 'VS Code reports the workspace folders through MCP roots and starts servers in the workspace folder.',
  codex: 'Codex CLI sends no roots and starts servers in the directory it was started from: the result above holds when Codex runs from the same directory.',
  cursor:
    'Unverified: Cursor documents MCP roots, but a user report says it does not answer `roots/list`. After restarting Cursor, call a Hesman tool; ' +
    'if it answers NO_PROJECT, run `hesman setup --client cursor --scope project` inside the project.',
  antigravity:
    'Unverified: whether Antigravity reports roots, and which working directory it gives servers, is not documented. After restarting it, call a ' +
    'Hesman tool; if it answers NO_PROJECT, add "--project-root", "/path/to/project" to the args of the hesman entry.',
  windsurf:
    'Unverified: whether Windsurf reports roots, and which working directory it gives servers, is not documented. After restarting it, call a ' +
    'Hesman tool; if it answers NO_PROJECT, add "--project-root", "/path/to/project" to the args of the hesman entry.',
};

type RegistryAnswer = 'published' | 'missing' | 'unknown';

/** One doctor run: the machine plus what must not be asked twice. */
interface Run {
  env: ClientEnvironment;
  machine: DoctorEnvironment;
  timeoutMs: number;
  registry: Map<string, Promise<RegistryAnswer>>;
}

function askRegistry(name: string, run: Run): Promise<RegistryAnswer> {
  let answer = run.registry.get(name);
  if (!answer) {
    answer = run.machine.fetchStatus(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, REGISTRY_TIMEOUT_MS).then(
      (status) => (status === 200 ? 'published' : status === 404 ? 'missing' : 'unknown'),
      () => 'unknown',
    );
    run.registry.set(name, answer);
  }
  return answer;
}

/** Package name of an `npx` entry: the first non-flag argument without its version. */
function npxPackage(args: readonly string[]): string | undefined {
  const spec = args.find((arg) => !arg.startsWith('-'));
  if (spec === undefined) return undefined;
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

/** Check 2: will the client find the configured command? */
async function commandCheck(client: ClientAdapter, configured: ServerEntry, run: Run): Promise<Check> {
  const { env, machine } = run;
  const { command } = configured;
  const setup = `hesman setup --client ${client.id}`;

  if (isAbsolutePath(command)) {
    if (!machine.exists(command)) {
      return {
        id: 'command',
        status: 'fail',
        message: `The configured command ${command} does not exist (was that Node version removed or switched?).`,
        fix: setup,
      };
    }
    const script = configured.args.find((arg) => isAbsolutePath(arg) && /\.[cm]?js$/.test(arg));
    if (script !== undefined && !machine.exists(script)) {
      return {
        id: 'command',
        status: 'fail',
        message: `The configured entry script ${script} does not exist (was the Hesman checkout or installation moved?).`,
        fix: setup,
      };
    }
    return {
      id: 'command',
      status: 'pass',
      message: script === undefined ? `${command} exists.` : `${command} and the entry script ${script} exist; no PATH is needed.`,
    };
  }

  const found = env.findOnPath(command);
  if (found === undefined) {
    return { id: 'command', status: 'fail', message: `\`${command}\` is not on PATH, so the client cannot start it.`, fix: setup };
  }

  const absolute = `${setup} --command absolute`;
  const warnings: string[] = [];
  let published = '';
  if (/^npx(\.cmd|\.exe)?$/i.test(command) && !runsFromNpxCache(env)) {
    const name = npxPackage(configured.args);
    const answer = name === undefined ? 'unknown' : await askRegistry(name, run);
    if (name !== undefined && answer === 'missing') {
      return {
        id: 'command',
        status: 'fail',
        message: `\`${commandLine(configured)}\` cannot start: ${name} is not published on npm (the registry answered 404).`,
        fix: absolute,
        details: { registry: answer },
      };
    }
    if (answer === 'published') published = ` ${name} is on the npm registry.`;
    else if (name !== undefined) {
      warnings.push(
        `Could not ask the npm registry whether ${name} exists (offline?).` +
          (name === PACKAGE_NAME ? ` It was not published as of ${NOT_PUBLISHED_AS_OF}; if it still is not, this entry cannot start.` : ''),
      );
    }
  }
  if (client.kind === 'gui' && !resolvableByGuiApps(command, env)) {
    warnings.push(
      `\`${command}\` is at ${found}; it or its \`node\` is outside the standard system directories. ${client.label} is a desktop app and does ` +
        'not get your shell PATH when opened from the Dock or a launcher, so it may not find it.',
    );
  }
  if (warnings.length > 0) return { id: 'command', status: 'warn', message: warnings.join(' '), fix: absolute, details: { path: found } };
  return { id: 'command', status: 'pass', message: `\`${command}\` is on PATH at ${found}.${published}`, details: { path: found } };
}

/** Check 3: did the started command answer `initialize` in time? */
function handshakeCheck(started: ServerEntry, probe: ProbeResult, client: ClientAdapter, timeoutMs: number): Check {
  const line = commandLine(started);
  if (probe.spawnError !== undefined) {
    return { id: 'handshake', status: 'fail', message: `Could not start \`${line}\`: ${probe.spawnError}.`, fix: `hesman setup --client ${client.id}` };
  }
  if (probe.handshakeMs !== undefined) {
    return {
      id: 'handshake',
      status: 'pass',
      message: `MCP \`initialize\` answered in ${probe.handshakeMs} ms (limit ${timeoutMs} ms).`,
      details: { ms: probe.handshakeMs, timeoutMs, ...(probe.server ? { server: probe.server } : {}) },
    };
  }
  const stderr = probe.stderrTail.length > 0 ? ` Last output: ${clip(probe.stderrTail.slice(-3).join(' | '), 400)}` : '';
  if (probe.exit) {
    const how = probe.exit.signal ? `was killed by ${probe.exit.signal}` : `exited with code ${probe.exit.code}`;
    return {
      id: 'handshake',
      status: 'fail',
      message: `The server ${how} before answering \`initialize\`.${stderr}`,
      fix: `Run it by hand to see the error: ${line}`,
      details: { exit: probe.exit },
    };
  }
  return {
    id: 'handshake',
    status: 'fail',
    message: `The server gave no answer to \`initialize\` within ${timeoutMs} ms; clients give up on servers that start this slowly.${stderr}`,
    fix: `Run it by hand to see where it hangs: ${line} (a first \`npx\` start downloads the package: retry with \`hesman doctor --timeout 60000\`)`,
    details: { timeoutMs },
  };
}

/** Check 4: stdout is the JSON-RPC channel and nothing else. */
function stdoutCheck(probe: ProbeResult, client: ClientAdapter): Check {
  const lines = probe.nonProtocolStdout;
  if (lines.length > 0) {
    return {
      id: 'stdout',
      status: 'fail',
      message: `${lines.length} line(s) on stdout are not JSON-RPC, which corrupts the MCP stream. First: "${clip(lines[0])}"`,
      fix: `hesman setup --client ${client.id}`,
      details: { lines: lines.slice(0, 5).map((l) => clip(l)) },
    };
  }
  if (probe.handshakeMs === undefined) return { id: 'stdout', status: 'skip', message: 'Not checked: the server did not start.' };
  return { id: 'stdout', status: 'pass', message: 'stdout carried only JSON-RPC messages.' };
}

/** Check 5: which project the server would index — as far as that can be known without the client. */
function projectCheck(
  client: ClientAdapter,
  pinned: PinnedRoot | undefined,
  probe: ProbeResult | undefined,
  /** Directory the server was (or would be) started in: the entry's `cwd`, else doctor's own. */
  startDir: string,
  /** The entry has a `cwd`, so the client does not choose the working directory. */
  fixedDir: boolean,
  machine: DoctorEnvironment,
): Check {
  if (pinned && hasClientVariable(pinned.value)) {
    const cursorGlobal = client.id === 'cursor';
    return {
      id: 'project',
      status: 'warn',
      message:
        `The entry passes \`--project-root ${pinned.value}\`. Only ${client.label} can expand that variable, so doctor cannot tell which directory it becomes.` +
        (cursorGlobal ? ' In the global Cursor config it may be the home directory; `hesman setup` no longer writes it there.' : ''),
      ...(cursorGlobal ? { fix: 'hesman setup --client cursor' } : {}),
      details: { source: 'explicit', root: pinned.value },
    };
  }
  if (pinned) {
    const root = isAbsolutePath(pinned.value) ? pinned.value : resolve(startDir, pinned.value);
    if (!machine.exists(root)) {
      return {
        id: 'project',
        status: 'fail',
        message: `The entry pins the project to ${root}, which does not exist.`,
        fix:
          client.id === 'claude-desktop'
            ? 'hesman setup --client claude-desktop --project-root <path>'
            : `Correct or remove the "--project-root" argument of the hesman entry in ${client.configPath('user')}.`,
        details: { source: 'explicit', root },
      };
    }
    return {
      id: 'project',
      status: 'pass',
      message: `Explicit root: the entry pins the project to ${root}. ${client.label} always gets this project, whatever folder is open.`,
      details: { source: 'explicit', root },
    };
  }
  if (client.id === 'claude-desktop' && !fixedDir) {
    return {
      id: 'project',
      status: 'fail',
      message: 'Claude Desktop has no workspace and this entry names no project, so every tool answers NO_PROJECT.',
      fix: 'hesman setup --client claude-desktop --project-root <path>',
      details: { source: 'none' },
    };
  }
  if (!probe) return { id: 'project', status: 'skip', message: 'Not checked: the server was not started.' };

  const tested = `No explicit root. Started in ${startDir}${fixedDir ? ' (the `cwd` of the entry)' : ''} without client roots, the server`;
  switch (probe.project.state) {
    case 'opened':
      return {
        id: 'project',
        status: 'pass',
        message: `${tested} indexes ${probe.project.root} (source: ${probe.project.source}).`,
        details: { source: probe.project.source, root: probe.project.root, testedFrom: startDir },
      };
    case 'none':
      return {
        id: 'project',
        status: 'warn',
        message: `${tested} finds no project and every tool answers NO_PROJECT. A client that reports its workspace folder still gets one.`,
        fix: 'Run `hesman doctor` inside the project, or add "--project-root", "/path/to/project" to the args of the hesman entry.',
        details: { source: 'none', testedFrom: startDir },
      };
    case 'unknown':
      return {
        id: 'project',
        status: probe.handshakeMs === undefined ? 'skip' : 'warn',
        message: `Could not find out which project the server opens: ${probe.project.reason}.`,
        details: { testedFrom: startDir },
      };
  }
}

const skipped = (ids: string[], reason: string): Check[] => ids.map((id) => ({ id, status: 'skip', message: reason }));

const WORST: Array<Exclude<CheckStatus, 'skip'>> = ['fail', 'warn', 'pass'];
const worstOf = (checks: Check[]): Exclude<CheckStatus, 'skip'> => WORST.find((status) => checks.some((c) => c.status === status)) ?? 'pass';

async function checkClient(client: ClientAdapter, named: boolean, run: Run): Promise<ClientReport> {
  const { env, machine } = run;
  const configPath = client.configPath('user');
  const setup = `hesman setup --client ${client.id}`;
  const report = (checks: Check[], extra: Partial<ClientReport> = {}): ClientReport => ({
    id: client.id,
    label: client.label,
    kind: client.kind,
    detected: client.detect(),
    configPath,
    configured: null,
    expected: null,
    status: worstOf(checks),
    checks,
    unverifiable: [],
    ...extra,
  });
  const notConfigured = (text: string, status: CheckStatus, fix: string): ClientReport =>
    report([{ id: 'config', status, message: text, fix }, ...skipped(['entry', 'command', 'handshake', 'stdout', 'project'], 'Not checked: there is no usable hesman entry.')]);
  // A client the user asked about must be configured; one that merely looks installed need not be.
  const absent: CheckStatus = named ? 'fail' : 'warn';

  // 1a. The config file exists, parses and has the entry. A dry-run removal reads and parses the
  // file exactly like `hesman setup` does and changes nothing.
  if (!machine.exists(configPath)) {
    return notConfigured(`${configPath} does not exist, so Hesman is not configured in ${client.label}.`, absent, setup);
  }
  let hasEntry: boolean;
  try {
    hasEntry = client.remove({ scope: 'user', dryRun: true }).status !== 'absent';
  } catch (err) {
    return notConfigured(message(err), 'fail', 'Fix the file by hand (Hesman reads strict JSON: no comments, no trailing commas), then run `hesman doctor` again.');
  }
  if (!hasEntry) return notConfigured(`${configPath} has no \`${SERVER_NAME}\` entry.`, absent, setup);
  const configured = client.read('user');
  if (!configured) return notConfigured(`The \`${SERVER_NAME}\` entry in ${configPath} has no usable \`command\`.`, 'fail', setup);
  const checks: Check[] = [{ id: 'config', status: 'pass', message: `${configPath} parses and has a \`${SERVER_NAME}\` entry.` }];

  let leftover: string | undefined;
  try {
    leftover = entryCwd(readFileSync(configPath, 'utf-8'));
  } catch {
    // Unreadable now: treated as an entry without `cwd`.
  }
  const startDir = leftover !== undefined && machine.exists(leftover) ? leftover : env.cwd;

  // 1b. The entry is what `hesman setup` would write now. A project the entry already pins is kept:
  // setup's own notes tell users to add one by hand for clients that report no workspace.
  const pinned = pinnedRoot(configured.args);
  const launch = launchFor(client, 'auto', env);
  const desktop = client.id === 'claude-desktop';
  const expected: ServerEntry = {
    command: launch.entry.command,
    args: [...launch.entry.args, ...(pinned ? ['--project-root', pinned.value] : desktop ? ['--project-root', '<path>'] : [])],
  };
  let current = false;
  let problem = '';
  try {
    const dryRun = desktop
      ? client.write(launch.entry, { scope: 'user', dryRun: true, projectRoot: pinned && !hasClientVariable(pinned.value) ? pinned.value : undefined })
      : client.write({ command: launch.entry.command, args: [...launch.entry.args, ...(pinned?.args ?? [])] }, { scope: 'user', dryRun: true });
    current = dryRun.status === 'unchanged';
  } catch (err) {
    problem = ` (${message(err)})`;
  }
  if (current) {
    checks.push({
      id: 'entry',
      status: 'pass',
      message:
        `The entry is what \`hesman setup\` writes now${pinned && !desktop ? ', plus the --project-root it already had' : ''}.` +
        // Setup leaves a `cwd` alone where the client documents the field (Codex).
        (leftover !== undefined ? ` It also has a \`cwd\` (${leftover}), so the server always starts there.` : ''),
    });
  } else {
    const sameLaunch = configured.command === launch.entry.command && isDeepStrictEqual(pinned?.rest ?? configured.args, launch.entry.args);
    const leftoverCwd = leftover !== undefined;
    checks.push({
      id: 'entry',
      status: 'warn',
      message:
        `The entry differs from what \`hesman setup\` would write now${problem}.` +
        (leftoverCwd ? ' It has a leftover `cwd`, which ties the server to one working directory.' : '') +
        (sameLaunch && !leftoverCwd ? ' The command is the same; another field differs.' : ''),
      fix: setup,
      details: { configured: commandLine(configured), expected: commandLine(expected), leftoverCwd },
    });
  }

  // 2. The command resolves where the client will look for it.
  const command = await commandCheck(client, configured, run);
  checks.push(command);

  // 3–5. Start it the way a client does. A variable only the client can expand is left out.
  const started: ServerEntry = { command: configured.command, args: pinned && hasClientVariable(pinned.value) ? pinned.rest : configured.args };
  let probe: ProbeResult | undefined;
  if (command.status === 'fail') {
    checks.push(...skipped(['handshake', 'stdout'], 'Not checked: the configured command cannot be started.'));
  } else {
    probe = await machine.probe({ command: started.command, args: started.args, cwd: startDir, timeoutMs: run.timeoutMs });
    checks.push(handshakeCheck(started, probe, client, run.timeoutMs), stdoutCheck(probe, client));
  }
  checks.push(projectCheck(client, pinned, probe, startDir, leftover !== undefined, machine));

  const unverifiable: string[] = [];
  if ((!desktop || leftover !== undefined) && (!pinned || hasClientVariable(pinned.value))) {
    unverifiable.push(
      `Doctor cannot see the workspace folders (MCP roots) or the working directory that ${client.label} gives the server; it tested from ` +
        `${startDir} and reported no roots. Roots from the client take precedence over the working directory.`,
    );
    const fact = PROJECT_FACTS[client.id];
    if (fact) unverifiable.push(fact);
  }
  if (client.kind === 'gui' && env.platform !== 'win32' && !isAbsolutePath(configured.command) && probe) {
    unverifiable.push(
      `Doctor started \`${configured.command}\` with this terminal's PATH; ${client.label} opened from the Dock or a launcher may see a shorter one.`,
    );
  }
  return report(checks, { configured, expected, unverifiable });
}

// ── Output ───────────────────────────────────────────────────────────────

const LABEL: Record<CheckStatus, string> = { pass: 'ok  ', warn: 'warn', fail: 'FAIL', skip: 'skip' };

function printChecks(checks: Check[], io: DoctorIo): void {
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    // Checks skipped for one reason are one line, not five.
    let ids = check.id;
    while (check.status === 'skip' && checks[i + 1]?.status === 'skip' && checks[i + 1].message === check.message) ids += `, ${checks[++i].id}`;
    io.out(`  ${LABEL[check.status]}  ${check.status === 'skip' ? `${ids}: ` : ''}${check.message}`);
    if (check.id === 'entry' && check.details && check.status !== 'pass') {
      io.out(`        configured: ${String(check.details.configured)}`);
      io.out(`        setup now:  ${String(check.details.expected)}`);
    }
    if (check.fix) io.out(`        fix: ${check.fix}`);
  }
}

function printReport(report: DoctorReport, named: boolean, io: DoctorIo): void {
  io.out(`hesman doctor — hesman v${report.version}. Nothing is changed; fixes are printed, not applied.`);
  io.out('');
  io.out('This installation');
  printChecks(report.server.checks, io);

  if (report.clients.length === 0) {
    io.out('');
    io.out(`No supported client was detected. Check one with --client <name…> (${CLIENT_IDS.join(', ')}).`);
  }
  for (const client of report.clients) {
    io.out('');
    io.out(`${client.label} (${client.id})${client.detected || !named ? '' : ' — not detected on this machine'}`);
    io.out(`  config: ${client.configPath}`);
    printChecks(client.checks, io);
    for (const note of client.unverifiable) io.out(`  not verifiable: ${note}`);
  }

  const { pass, warn, fail, skip } = report.summary;
  io.out('');
  io.out(`Summary: ${pass} passed, ${warn} warning(s), ${fail} failed, ${skip} skipped.`);
}

/**
 * `hesman doctor [--client <name…>] [--json] [--timeout <ms>]`: checks this installation and the
 * Hesman entry of each client, starting the configured command once per client. Read-only: it
 * prints fixes and applies none. Resolves with the exit code — 1 when any check failed.
 */
export async function runDoctor(args: readonly string[], io: DoctorIo, machine: DoctorEnvironment): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(args);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.out(err.message);
    return 1;
  }

  const run: Run = { env: io.env, machine, timeoutMs: options.timeoutMs, registry: new Map() };
  const clients = allClients(io.env);
  const named = options.names.length > 0;
  const chosen = named ? options.names.map((id) => clients.find((c) => c.id === id)!) : clients.filter((c) => c.detect());

  const server = { checks: serverChecks(io.env, machine) };
  const reports: ClientReport[] = [];
  // One at a time: each start is a real process, and the output order is the client order.
  for (const client of chosen) reports.push(await checkClient(client, named, run));

  const summary: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of [...server.checks, ...reports.flatMap((r) => r.checks)]) summary[check.status]++;
  const report: DoctorReport = { version: io.env.installation.version, ok: summary.fail === 0, summary, server, clients: reports };

  if (options.json) io.out(JSON.stringify(report, null, 2));
  else printReport(report, named, io);
  return report.ok ? 0 : 1;
}
