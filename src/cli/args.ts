/**
 * Minimal CLI argument splitter shared by the `hesman` subcommands.
 *
 * Anything starting with `-` is a flag; everything else is a positional
 * argument. Flags listed in `valueFlags` consume the next argument as their
 * value (or take it from `--flag=value`), so that value is never mistaken for
 * a positional such as the project path.
 */
export interface SplitArgs {
  positionals: string[];
  /** Boolean flags that were present, e.g. `--force`. */
  flags: Set<string>;
  /** Values of value-taking flags, e.g. `--agent claude` -> `--agent` => `claude`. */
  values: Map<string, string>;
}

/** Config override flags understood by the loader; each takes a value. */
export const CONFIG_VALUE_FLAGS = ['--workers', '--log-level', '--data-dir', '--watch-mode', '--batch-size'] as const;

export function splitArgs(args: readonly string[], valueFlags: readonly string[] = CONFIG_VALUE_FLAGS): SplitArgs {
  const result: SplitArgs = { positionals: [], flags: new Set(), values: new Map() };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-') || arg === '-') {
      result.positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (valueFlags.includes(name)) {
      if (eq !== -1) {
        result.values.set(name, arg.slice(eq + 1));
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        result.values.set(name, args[++i]);
      }
      continue;
    }

    result.flags.add(arg);
  }

  return result;
}
