import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCode, formatError } from './error-codes.js';

/**
 * Which project does this server process index?
 *
 * One globally installed MCP entry must work in every workspace, so the
 * project is resolved at runtime, in this order:
 *
 * 1. an explicit root: `--project-root`, `HESMAN_PROJECT_ROOT` or
 *    `projectRoot` in `hesman.config.json` (`explicitProjectRoot`);
 * 2. the workspace folders the MCP client reports through `roots/list`
 *    (`pickProjectRoot`);
 * 3. the working directory, when it is inside something that looks like a
 *    project (`findProjectRoot`);
 * 4. otherwise no project: tools answer with `noProjectResult`.
 *
 * The functions here are pure lookups; `src/index.ts` drives them.
 */

/** Version-control directories that mark the top of a project. */
const VCS_DIRS = ['.git', '.hg', '.svn', '.jj'];

/** Manifest files that mark the top of a project. */
const MANIFEST_FILES = [
  'hesman.config.json',
  'package.json',
  'deno.json',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
  'CMakeLists.txt',
  'Makefile',
];

const PROJECT_MARKERS = [...VCS_DIRS, ...MANIFEST_FILES];

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isSameOrAncestor(ancestor: string, target: string): boolean {
  const rel = relative(ancestor, target);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false; // different drive on Windows
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * True for directories that must never be picked automatically: the home
 * directory and everything above it (which includes the filesystem root).
 * Indexing them would crawl the user's whole disk.
 */
function isTooBroad(dir: string, homeDir: string): boolean {
  const real = canonical(dir);
  if (dirname(real) === real) return true; // filesystem root
  return isSameOrAncestor(real, canonical(homeDir));
}

/**
 * The root the user asked for, as an absolute path, or `null` when nothing
 * names one. `configuredRoot` is the merged `config.projectRoot`; its default
 * `.` only counts as explicit when a flag or the env var actually set it.
 */
export function explicitProjectRoot(
  configuredRoot: string,
  cliOverrides: { projectRoot?: string },
  env: NodeJS.ProcessEnv,
  cwd: string,
): string | null {
  const wasSet = cliOverrides.projectRoot !== undefined || Boolean(env.HESMAN_PROJECT_ROOT) || configuredRoot !== '.';
  return wasSet ? resolve(cwd, configuredRoot) : null;
}

/** Local path of a `file://` root URI, or `null` for anything else. */
export function rootUriToPath(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return null;
    // A host means a network share; there is no local directory to index.
    if (url.hostname !== '' && url.hostname !== 'localhost') return null;
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

export interface PickedRoot {
  /** The folder to index, or `null` when no reported root is usable. */
  root: string | null;
  /** Further usable roots, not indexed (one process serves one project). */
  others: string[];
  /** Reported roots that cannot be indexed, with the reason, for the log. */
  rejected: Array<{ uri: string; reason: string }>;
}

/** Chooses the project among the roots reported by the MCP client: the first usable one. */
export function pickProjectRoot(roots: ReadonlyArray<{ uri: string }>, homeDir: string): PickedRoot {
  const usable: string[] = [];
  const rejected: PickedRoot['rejected'] = [];

  for (const { uri } of roots) {
    const path = rootUriToPath(uri);
    if (path === null) {
      rejected.push({ uri, reason: 'not a local file:// URI' });
      continue;
    }
    let isDirectory = false;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      // Missing or unreadable: treated as not a directory.
    }
    if (!isDirectory) {
      rejected.push({ uri, reason: 'not an existing directory' });
    } else if (isTooBroad(path, homeDir)) {
      rejected.push({ uri, reason: 'the home directory or one of its parents is too broad to index' });
    } else {
      usable.push(path);
    }
  }

  return { root: usable[0] ?? null, others: usable.slice(1), rejected };
}

/**
 * Walks up from `startDir` to the nearest directory holding a VCS directory
 * or a known manifest. Returns `null` when there is none, or when the match is
 * the home directory or above it: a stray `~/package.json` or a dotfiles
 * repository must not make the server index the whole home directory.
 */
export function findProjectRoot(startDir: string, homeDir: string): string | null {
  let dir = resolve(startDir);

  while (true) {
    if (isTooBroad(dir, homeDir)) return null;
    if (PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)))) return dir;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Text of the error every tool returns while no project is selected. */
export function noProjectMessage(cwd: string): string {
  return (
    'No project is selected, so there is nothing to search. Hesman picks the project from ' +
    '(1) --project-root or HESMAN_PROJECT_ROOT, (2) the workspace folders reported by the MCP client (roots), ' +
    '(3) its working directory when that is inside a project (a VCS directory or a manifest such as package.json, ' +
    `go.mod or pyproject.toml). None of these applied (working directory: ${cwd}). ` +
    'To fix it, add "--project-root", "/absolute/path/to/project" to the args of the hesman entry in your MCP ' +
    'client configuration (or set HESMAN_PROJECT_ROOT in its env) and restart the server.'
  );
}

/** MCP tool result carrying the "no project" error. `message` overrides the default text. */
export function noProjectResult(
  cwd: string,
  message: string = noProjectMessage(cwd),
): { content: Array<{ type: string; text: string }>; isError: true } {
  return {
    content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.NO_PROJECT, message)) }],
    isError: true,
  };
}
