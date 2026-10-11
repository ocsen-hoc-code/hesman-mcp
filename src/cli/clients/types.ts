/** Clients `hesman setup` knows how to configure, in the order they are listed to the user. */
export const CLIENT_IDS = [
  'claude-code',
  'claude-desktop',
  'codex',
  'cursor',
  'antigravity',
  'vscode',
  'gemini-cli',
  'windsurf',
] as const;

export type ClientId = (typeof CLIENT_IDS)[number];

/** `user`: one config for every project of this user. `project`: a file inside the current project. */
export type Scope = 'user' | 'project';

/**
 * `cli`: started from a terminal, so it sees the user's shell PATH. `gui`: a desktop app that, when
 * opened from the Dock or a launcher, gets a minimal PATH without version-manager directories.
 */
export type ClientKind = 'cli' | 'gui';

/** Facts about the running Hesman, used to decide how clients should launch it. */
export interface Installation {
  /** Absolute path of the Node binary running Hesman (`process.execPath`). */
  execPath: string;
  /** Absolute path of this installation's server entry script (`<package>/dist/index.js`). */
  entryScript: string;
  /** Version from this installation's `package.json`. */
  version: string;
}

/** How a client starts the Hesman server. Produced by `serverEntry()`; adapters may append args. */
export interface ServerEntry {
  command: string;
  args: string[];
}

export interface RunResult {
  /** Exit status; non-zero (or -1 when the process could not start) means failure. */
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Everything an adapter needs from the machine. Injected so tests use a temp home, a fake PATH
 * and a recording runner: adapters never call `os.homedir()`, `process.*` or `child_process`.
 */
export interface ClientEnvironment {
  home: string;
  /** Working directory: the project for the `project` scope and Claude Desktop's default project. */
  cwd: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  installation: Installation;
  /** Absolute path of an executable on PATH, or undefined. */
  findOnPath(name: string): string | undefined;
  /** `path` with symbolic links resolved; `path` itself when it cannot be resolved. */
  realpath(path: string): string;
  /** Runs a client CLI (`claude mcp add …`, `codex mcp add …`) and waits for it. */
  run(command: string, args: string[], options?: { cwd?: string }): RunResult;
}

export interface ChangeOptions {
  /** Defaults to `user`. Adapters throw when the client does not support the scope. */
  scope?: Scope;
  /** Compute and describe the change, write nothing and run nothing. */
  dryRun?: boolean;
  /** Only for clients that cannot tell the server which project is open (Claude Desktop). */
  projectRoot?: string;
}

export type ChangeStatus = 'added' | 'updated' | 'unchanged' | 'removed' | 'absent';

export interface ChangeResult {
  client: ClientId;
  status: ChangeStatus;
  /** `cli`: done by the client's own CLI. `file`: Hesman edited the config file. */
  via: 'cli' | 'file';
  /** False for dry runs and for `unchanged` / `absent`. */
  applied: boolean;
  configPath: string;
  /** Backup of the previous config file, when one was replaced. */
  backupPath?: string;
  /** The exact change: the config fragment written or removed, or the CLI command line. */
  preview: string;
  /** Things the user should know (pinned project, unverified behavior, CLI fallback). */
  notes: string[];
}

export interface ClientAdapter {
  id: ClientId;
  /** Human-readable name, e.g. "VS Code (Copilot)". */
  label: string;
  kind: ClientKind;
  scopes: readonly Scope[];
  /** True when the client looks installed (its CLI is on PATH or its config directory exists). */
  detect(): boolean;
  configPath(scope?: Scope): string;
  /** The Hesman entry currently in the config file; undefined when absent or unreadable. */
  read(scope?: Scope): ServerEntry | undefined;
  /** Adds or updates the Hesman entry. Idempotent; never touches other servers. */
  write(entry: ServerEntry, options?: ChangeOptions): ChangeResult;
  /** Removes the Hesman entry, restoring the file byte for byte when nothing else changed. */
  remove(options?: ChangeOptions): ChangeResult;
}
