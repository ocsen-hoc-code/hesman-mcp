import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ErrorCode, formatError, type ErrorCodeType } from './error-codes.js';

/**
 * Path containment for tool arguments.
 *
 * Tool input is untrusted: an agent can be prompt-injected by the code it reads,
 * so every path a tool reads from disk must go through `resolveProjectPath`.
 */

/** Thrown when a tool path argument is rejected. `code` is the tool error code to report. */
export class ProjectPathError extends Error {
  readonly code: ErrorCodeType;

  constructor(code: ErrorCodeType, message: string) {
    super(message);
    this.name = 'ProjectPathError';
    this.code = code;
  }
}

export interface ResolveProjectPathOptions {
  /** Files larger than this are rejected with INVALID_INPUT. */
  maxFileSizeBytes: number;
}

/** True when `target` is `root` itself or lies below it (both must be absolute, same form). */
function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false; // different drive on Windows
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

function assertPathString(input: unknown): asserts input is string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new ProjectPathError(ErrorCode.INVALID_INPUT, 'filePath must be a non-empty string');
  }
  if (input.includes('\0')) {
    throw new ProjectPathError(ErrorCode.INVALID_INPUT, 'filePath must not contain NUL bytes');
  }
}

/**
 * Lexically resolve `input` against `projectRoot` without touching the disk.
 * Relative paths resolve against the root; absolute paths are only normalized.
 * The result has the same form as the scanner's DB keys (`join(resolve(root), relative)`).
 * Use this for tools that only query the index; it does NOT enforce containment.
 */
export function normalizeProjectPath(projectRoot: string, input: string): string {
  return resolve(resolve(projectRoot), input);
}

/**
 * Resolve `input` to a readable regular file inside `projectRoot`.
 *
 * - Relative paths resolve against `projectRoot`.
 * - Containment is checked on the realpath of both sides, so a symlink inside
 *   the root that points outside it is rejected (PATH_OUTSIDE_PROJECT).
 * - The target must be a regular file no larger than `maxFileSizeBytes`
 *   (INVALID_INPUT otherwise; FILE_NOT_FOUND for a missing in-root path).
 *
 * Returns the absolute path in the un-realpathed root form, matching the
 * scanner's DB keys (e.g. `/var/...` rather than `/private/var/...` on macOS).
 *
 * @throws ProjectPathError
 */
export function resolveProjectPath(
  projectRoot: string,
  input: string,
  options: ResolveProjectPathOptions,
): string {
  assertPathString(input);
  const absRoot = resolve(projectRoot);
  const candidate = resolve(absRoot, input);
  const lexicallyInside = isWithin(absRoot, candidate);

  let realRoot: string;
  try {
    realRoot = realpathSync(absRoot);
  } catch {
    throw new ProjectPathError(ErrorCode.INTERNAL_ERROR, `Project root is not accessible: ${absRoot}`);
  }

  let realTarget: string;
  try {
    realTarget = realpathSync(candidate);
  } catch {
    // Do not reveal whether paths outside the project exist.
    if (lexicallyInside) {
      throw new ProjectPathError(ErrorCode.FILE_NOT_FOUND, `File not found: ${input}`);
    }
    throw new ProjectPathError(ErrorCode.PATH_OUTSIDE_PROJECT, `Path is outside the project root: ${input}`);
  }

  if (!isWithin(realRoot, realTarget)) {
    throw new ProjectPathError(ErrorCode.PATH_OUTSIDE_PROJECT, `Path is outside the project root: ${input}`);
  }

  let st;
  try {
    st = statSync(realTarget);
  } catch {
    throw new ProjectPathError(ErrorCode.FILE_NOT_FOUND, `File not found: ${input}`);
  }
  if (!st.isFile()) {
    throw new ProjectPathError(ErrorCode.INVALID_INPUT, `Not a regular file: ${input}`);
  }
  if (st.size > options.maxFileSizeBytes) {
    throw new ProjectPathError(
      ErrorCode.INVALID_INPUT,
      `File is too large (${st.size} bytes, limit ${options.maxFileSizeBytes}): ${input}`,
    );
  }

  // Keep the root form used by the index. A path given in realpath form
  // (e.g. `/private/var/...`) is mapped back under `absRoot`.
  return lexicallyInside ? candidate : join(absRoot, relative(realRoot, realTarget));
}

/** Build the MCP error result for a ProjectPathError. */
export function projectPathErrorResult(err: ProjectPathError): {
  content: Array<{ type: string; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(formatError(err.code, err.message)) }],
    isError: true,
  };
}
