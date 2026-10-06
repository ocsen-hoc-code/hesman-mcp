import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** Outcome of {@link writeConfigAtomically}. */
export interface ConfigWriteResult {
  /** True when the file on disk was replaced (or created). */
  written: boolean;
  /** Path of the backup taken of the previous file, if one existed and was replaced. */
  backupPath: string | undefined;
}

/** Backup location used for an agent config file: `<config>.hesman.bak`. */
export function backupPathFor(configPath: string): string {
  return `${configPath}.hesman.bak`;
}

/**
 * Safely write an agent config file (any text format: JSON, TOML, ...).
 *
 * - Idempotent: if the file already holds exactly `content`, nothing is touched.
 * - Backup: an existing file is copied to `<config>.hesman.bak` (overwriting any older backup).
 * - Atomic: content goes to `<config>.tmp-<pid>` in the same directory, then is renamed over
 *   the original, so an interrupted write never leaves a truncated config behind.
 * - Missing parent directories are created.
 */
export function writeConfigAtomically(configPath: string, content: string): ConfigWriteResult {
  const exists = existsSync(configPath);
  if (exists && readFileSync(configPath, 'utf-8') === content) {
    return { written: false, backupPath: undefined };
  }

  mkdirSync(dirname(configPath), { recursive: true });

  let backupPath: string | undefined;
  if (exists) {
    backupPath = backupPathFor(configPath);
    copyFileSync(configPath, backupPath);
  }

  const tmpPath = `${configPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, configPath);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw err;
  }

  return { written: true, backupPath };
}
