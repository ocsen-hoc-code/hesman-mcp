import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * An append-only line file with a size cap and exactly one rotated file.
 *
 * Used for the server log (`log-file.ts`) and the tool-call log
 * (`tool-call-log.ts`). Both are written by the MCP server and read by another
 * process (`hesman ui`), so the format is plain lines appended with `O_APPEND`:
 * a reader never needs a lock and never blocks the writer.
 *
 * When the next line would push the file past `maxBytes`, the file is renamed
 * to `<path>.1` (replacing the previous one) and a new file is started, so the
 * two files together never hold more than `2 * maxBytes` — plus one line when
 * a single line is longer than the cap.
 *
 * Writing is best effort: no method throws. A failed write closes the file and
 * the next attempt is made after `RETRY_AFTER_MS`, so a broken disk costs one
 * failed syscall every few seconds instead of one per line.
 *
 * This module must not import the logger: the logger writes through it.
 */

const RETRY_AFTER_MS = 5000;

export interface RotatingFileOptions {
  /** Size at which the current file is rotated. */
  maxBytes: number;
}

/** Path of the single rotated file kept next to `path`. */
export function rotatedPath(path: string): string {
  return `${path}.1`;
}

export class RotatingFile {
  private fd: number | undefined;
  private retryAt = 0;
  private readonly path: string;
  private readonly maxBytes: number;

  constructor(path: string, options: RotatingFileOptions) {
    this.path = path;
    this.maxBytes = options.maxBytes;
  }

  /** Appends `line` plus a newline. Never throws. */
  append(line: string): void {
    try {
      if (this.fd === undefined) {
        if (Date.now() < this.retryAt) return;
        this.open();
      }
      const data = `${line}\n`;
      const bytes = Buffer.byteLength(data);
      if (this.sizeOfOpenFile() + bytes > this.maxBytes) {
        this.startNewFile();
        // Another writer may have started the new file already and filled it.
        if (this.sizeOfOpenFile() + bytes > this.maxBytes) this.startNewFile();
      }
      writeSync(this.fd as number, data);
    } catch {
      this.closeQuietly();
      this.retryAt = Date.now() + RETRY_AFTER_MS;
    }
  }

  /** Closes the file. Never throws; a later `append` reopens it. */
  close(): void {
    this.closeQuietly();
    this.retryAt = 0;
  }

  private open(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    this.fd = openSync(this.path, 'a');
  }

  private sizeOfOpenFile(): number {
    return fstatSync(this.fd as number).size;
  }

  /**
   * Makes `this.fd` point at a file with room: rotates the current file, or —
   * when another process rotated it already, so our descriptor is the rotated
   * file — just reopens the path.
   */
  private startNewFile(): void {
    const mine = fstatSync(this.fd as number);
    let current: { ino: number; dev: number } | undefined;
    try {
      current = statSync(this.path);
    } catch {
      current = undefined; // deleted under us (e.g. `hesman clean`): reopen creates it
    }
    const stillCurrent = current !== undefined && current.ino === mine.ino && current.dev === mine.dev;
    // An empty current file cannot be made roomier by rotating it.
    if (stillCurrent && mine.size > 0) renameSync(this.path, rotatedPath(this.path));
    closeSync(this.fd as number);
    this.fd = undefined;
    this.open();
  }

  private closeQuietly(): void {
    if (this.fd === undefined) return;
    try {
      closeSync(this.fd);
    } catch {
      // nothing useful to do
    }
    this.fd = undefined;
  }
}

function readLines(path: string): string[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return []; // missing, unreadable or not a file
  }
  return text.split('\n').filter((line) => line.length > 0);
}

/** Every non-empty line of the rotated file followed by the current file, oldest first. */
export function readRotatedLines(path: string): string[] {
  return [...readLines(rotatedPath(path)), ...readLines(path)];
}
