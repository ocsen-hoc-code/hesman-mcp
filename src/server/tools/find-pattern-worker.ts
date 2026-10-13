/**
 * Worker thread entry for `find_pattern`.
 *
 * Walks the project and runs regex matching off the main thread, so neither a
 * large directory tree nor a slow or pathological pattern can block the MCP
 * server. Streams each match back as it is found; the parent terminates this
 * worker when its time budget runs out.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import picomatch from 'picomatch';
import { scanProject } from '../../indexing/project-scanner.js';
import type { HesmanConfig } from '../../config/schema.js';
import { matchSource, type PatternMatch } from './find-pattern-matcher.js';

export interface FindPatternWorkerInput {
  projectRoot: string;
  /** Config used for the directory walk (already narrowed to the requested language). */
  scanConfig: HesmanConfig;
  /** Glob matched against the project-relative path with "/" separators. */
  filePattern?: string;
  regexSource: string;
  topK: number;
}

export type FindPatternWorkerMessage =
  | { type: 'match'; match: PatternMatch }
  | { type: 'skipped'; count: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

function toPosixRelative(root: string, filePath: string): string {
  const rel = relative(root, filePath);
  return sep === '/' ? rel : rel.split(sep).join('/');
}

/** Files of the requested language under the project root that match `filePattern`. */
function listCandidateFiles(input: Pick<FindPatternWorkerInput, 'projectRoot' | 'scanConfig' | 'filePattern'>): string[] {
  const isMatch = input.filePattern ? picomatch(input.filePattern) : null;
  return scanProject(input.projectRoot, input.scanConfig)
    .map((f) => f.filePath)
    .filter((filePath) => !isMatch || isMatch(toPosixRelative(input.projectRoot, filePath)));
}

function run(input: FindPatternWorkerInput): void {
  const port = parentPort;
  if (!port) return;
  const regex = new RegExp(input.regexSource, 'g');
  let found = 0;

  for (const filePath of listCandidateFiles(input)) {
    if (found >= input.topK) break;
    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch {
      // Skip files that can't be read as text
      continue;
    }
    const result = matchSource(source, regex, filePath, input.topK - found, (match) => {
      port.postMessage({ type: 'match', match } satisfies FindPatternWorkerMessage);
    });
    found += result.matches.length;
    if (result.skippedLines > 0) {
      port.postMessage({ type: 'skipped', count: result.skippedLines } satisfies FindPatternWorkerMessage);
    }
  }
  port.postMessage({ type: 'done' } satisfies FindPatternWorkerMessage);
}

if (parentPort) {
  try {
    run(workerData as FindPatternWorkerInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort.postMessage({ type: 'error', message } satisfies FindPatternWorkerMessage);
  }
}
