import type { ToolHandler } from './mcp-server.js';
import { ErrorCode, formatError } from './error-codes.js';

/**
 * Validation helpers for numeric tool arguments.
 *
 * Rules:
 * - Missing (`undefined` or `null`) → the default.
 * - Not a finite number (strings, NaN, Infinity, ...) → InvalidArgumentError.
 * - `intArg` additionally rejects non-integers.
 * - Out of range → clamped to [min, max].
 */
export interface NumericArgOptions {
  default: number;
  min: number;
  max: number;
}

/** Thrown when a tool argument has the wrong type; mapped to INVALID_INPUT. */
export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Read an integer argument, clamping it to [min, max]. */
export function intArg(
  args: Record<string, unknown>,
  name: string,
  options: NumericArgOptions,
): number {
  const raw = args[name];
  if (raw === undefined || raw === null) return options.default;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new InvalidArgumentError(`${name} must be an integer`);
  }
  return clamp(raw, options.min, options.max);
}

/** Read a (possibly fractional) numeric argument, clamping it to [min, max]. */
export function numberArg(
  args: Record<string, unknown>,
  name: string,
  options: NumericArgOptions,
): number {
  const raw = args[name];
  if (raw === undefined || raw === null) return options.default;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new InvalidArgumentError(`${name} must be a finite number`);
  }
  return clamp(raw, options.min, options.max);
}

/** Wrap a tool handler so InvalidArgumentError becomes an INVALID_INPUT tool error. */
export function withArgValidation(handler: ToolHandler): ToolHandler {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof InvalidArgumentError) {
        const result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, err.message)),
            },
          ],
          isError: true,
        };
        return result;
      }
      throw err;
    }
  };
}

/** The `format` argument of a list tool: `compact` (default) or `full` (the plain payload). */
export function formatArg(args: Record<string, unknown>): 'compact' | 'full' {
  const raw = args.format;
  if (raw === undefined || raw === null) return 'compact';
  if (raw === 'compact' || raw === 'full') return raw;
  throw new InvalidArgumentError('format must be "compact" or "full"');
}
