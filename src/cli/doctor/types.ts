import type { ClientId, ClientKind, ServerEntry } from '../clients/types.js';

/** `skip`: the check could not run because an earlier one failed. Only `fail` makes doctor exit 1. */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface Check {
  /**
   * Installation checks: `entry-script`, `node`, `parsers`.
   * Client checks, always in this order: `config`, `entry`, `command`, `handshake`, `stdout`, `project`.
   */
  id: string;
  status: CheckStatus;
  /** What was found, in one sentence or two. */
  message: string;
  /** A command to run or an edit to make. Absent when there is nothing to do. */
  fix?: string;
  /** Machine-readable facts behind the message (documented per check in `docs/CLI.md`). */
  details?: Record<string, unknown>;
}

/** One start of a server command, as a client would do it. */
export interface ProbeRequest {
  command: string;
  args: string[];
  /** Working directory of the server process. */
  cwd: string;
  /** Limit for the `initialize` answer, in milliseconds. */
  timeoutMs: number;
}

/** What the started server said about its project when the client reports no roots. */
export type ProbedProject =
  | { state: 'opened'; root: string; source: string }
  /** Every tool answers `NO_PROJECT`. */
  | { state: 'none' }
  | { state: 'unknown'; reason: string };

export interface ProbeResult {
  /** The process could not be started at all (`ENOENT`, `EACCES`, …). */
  spawnError?: string;
  /** Time from spawn to the `initialize` answer; undefined when there was none. */
  handshakeMs?: number;
  /** No `initialize` answer within `timeoutMs`. */
  timedOut: boolean;
  /** Set when the process ended before answering `initialize`. */
  exit?: { code: number | null; signal: string | null };
  /** `serverInfo` of the `initialize` answer. */
  server?: { name: string; version: string };
  /** Non-empty stdout lines that are not JSON-RPC messages. */
  nonProtocolStdout: string[];
  /** Last lines the process wrote to stderr. */
  stderrTail: string[];
  project: ProbedProject;
}

/**
 * Machine access of `hesman doctor` beyond {@link ClientEnvironment}. Injected so tests simulate
 * every failure without spawning a process, touching the network or needing a real installation.
 */
export interface DoctorEnvironment {
  /** Version of the Node running doctor, without the leading `v`. */
  nodeVersion: string;
  /** `engines.node` of this installation's `package.json`, e.g. `>=20.0.0`. */
  enginesNode: string;
  /** Directory holding the bundled WASM grammars. */
  parsersDir: string;
  /** File names of the grammars the language registry needs. */
  grammars: readonly string[];
  exists(path: string): boolean;
  /** Starts the command, performs the MCP handshake, asks which project is open, stops it. Never rejects. */
  probe(request: ProbeRequest): Promise<ProbeResult>;
  /** HTTP status of a GET; rejects when the host cannot be reached within `timeoutMs`. */
  fetchStatus(url: string, timeoutMs: number): Promise<number>;
}

export interface ClientReport {
  id: ClientId;
  label: string;
  kind: ClientKind;
  /** The client looks installed on this machine. */
  detected: boolean;
  /** The user-scope config file that was examined. */
  configPath: string;
  /** The `hesman` entry found in it; `null` when there is none or the file cannot be read. */
  configured: ServerEntry | null;
  /** What `hesman setup --client <id>` would write now (keeping a `--project-root` already in the entry). */
  expected: ServerEntry | null;
  /** Worst status among the checks (`skip` counts as nothing). */
  status: Exclude<CheckStatus, 'skip'>;
  checks: Check[];
  /** What doctor cannot find out about this client, in plain sentences. */
  unverifiable: string[];
}

/** The object printed by `hesman doctor --json`. */
export interface DoctorReport {
  /** Version of the Hesman that ran doctor. */
  version: string;
  /** False when at least one check failed (exit code 1). */
  ok: boolean;
  summary: Record<CheckStatus, number>;
  /** Checks of this installation, independent of any client. */
  server: { checks: Check[] };
  clients: ClientReport[];
}
