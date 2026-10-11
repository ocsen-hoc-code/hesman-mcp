import type { ServerEntry } from './types.js';

/** The value stored for the `hesman` server: the launch command, plus `type` where a client wants it. */
export type EntryValue = ServerEntry & { type?: 'stdio' };

/**
 * Reads and edits the `hesman` server entry in one config file format. Every function is pure
 * (text in, text out) and throws when the file cannot be parsed or edited safely; `path` is only
 * used in error messages. `text` is `undefined` when the file does not exist.
 */
export interface ConfigCodec {
  read(text: string | undefined, path: string): ServerEntry | undefined;
  has(text: string | undefined, path: string): boolean;
  /** True when the file already starts Hesman exactly as `desired` says. */
  matches(text: string | undefined, desired: EntryValue, path: string): boolean;
  /** File content with the entry added or updated; everything else is kept. */
  apply(text: string | undefined, desired: EntryValue, path: string): string;
  /** File content without the entry. */
  strip(text: string, path: string): string;
  /** True when `backup` has no entry and adding the entry found in `text` to it yields exactly `text`. */
  restores(backup: string, text: string, path: string): boolean;
  /** True when `text` is exactly what `apply` produces for a missing file, i.e. Hesman created it. */
  isOnlyHesman(text: string, path: string): boolean;
  /** The fragment shown to the user as "the change". */
  snippet(desired: EntryValue): string;
}
