/**
 * Worker thread entry for `find_pattern`.
 *
 * Runs regex matching off the main thread so a slow or pathological pattern
 * cannot block the MCP server. Streams each match back as it is found; the
 * parent terminates this worker when its time budget runs out.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { matchSource, type PatternMatch } from './find-pattern-matcher.js';

export interface FindPatternWorkerInput {
  files: string[];
  regexSource: string;
  topK: number;
}

export type FindPatternWorkerMessage =
  | { type: 'match'; match: PatternMatch }
  | { type: 'skipped'; count: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

function run(input: FindPatternWorkerInput): void {
  const port = parentPort;
  if (!port) return;
  const regex = new RegExp(input.regexSource, 'g');
  let found = 0;

  for (const filePath of input.files) {
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
