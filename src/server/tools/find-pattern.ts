import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { HesmanConfig } from '../../config/schema.js';
import { ErrorCode, formatError } from '../error-codes.js';
import { intArg, withArgValidation } from '../args.js';
import { isLanguageId } from '../../parsers/languages.js';
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_GREEDY_PLACEHOLDERS,
  MAX_LINE_LENGTH,
  MAX_PATTERN_LENGTH,
  MAX_PLACEHOLDERS,
  compilePattern,
  validatePattern,
  type PatternMatch,
} from './find-pattern-matcher.js';
import type { FindPatternWorkerInput, FindPatternWorkerMessage } from './find-pattern-worker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Wall-clock budget for one search; the matching worker is terminated after this. */
export const MATCH_TIME_BUDGET_MS = 3_000;

const inputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      maxLength: MAX_PATTERN_LENGTH,
      description:
        `Structural pattern like console.$METHOD($$$ARGS). Use $NAME for word capture, $$$ARGS for greedy capture. ` +
        `Limits: at most ${MAX_PATTERN_LENGTH} characters, ${MAX_PLACEHOLDERS} placeholders in total, ` +
        `${MAX_GREEDY_PLACEHOLDERS} $$$ placeholders.`,
    },
    language: {
      type: 'string',
      description:
        'Language to search in: a parsed language (e.g. "typescript") or the label of a language without a grammar ' +
        '(e.g. "sql", "yaml", "zig", "dockerfile"; "text" for unrecognised text files)',
    },
    filePattern: {
      type: 'string',
      description: 'Glob matched against the path relative to the project root, with "/" separators (e.g. "src/**/*.ts")',
    },
    topK: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 20, max 100)' },
  },
  required: ['pattern', 'language'],
};

const DESCRIPTION =
  'Search code by structural pattern with named captures ($NAME for word tokens, $$$ARGS for greedy capture). ' +
  'Returned line numbers are 1-based; `line` is where the match starts, while `snippet` also includes up to 2 lines of context above and below it. ' +
  `Patterns are limited to ${MAX_PATTERN_LENGTH} characters, ` +
  `${MAX_PLACEHOLDERS} placeholders and ${MAX_GREEDY_PLACEHOLDERS} $$$ placeholders. ` +
  `Lines longer than ${MAX_LINE_LENGTH} characters are skipped and each search has a ${MATCH_TIME_BUDGET_MS}ms budget; ` +
  'incomplete results are flagged with truncated: true and a truncatedReason.';

/**
 * Locate the compiled worker: next to this module when running from dist/,
 * otherwise the repo's dist/ copy when running from source (vitest/tsx).
 */
function resolveWorkerPath(): string {
  const primaryPath = resolve(__dirname, 'find-pattern-worker.js');
  const fallbackPath = resolve(__dirname, '..', '..', '..', 'dist', 'server', 'tools', 'find-pattern-worker.js');
  const workerPath = existsSync(primaryPath) ? primaryPath : fallbackPath;
  if (!existsSync(workerPath)) {
    throw new Error(
      `find-pattern-worker.js not found at ${primaryPath} or ${fallbackPath}. Ensure the project is built (npx tsc).`,
    );
  }
  return workerPath;
}

interface SearchOutcome {
  matches: PatternMatch[];
  skippedLines: number;
  timedOut: boolean;
}

/** Scan and match in a dedicated worker, terminating it when the budget runs out. */
function searchInWorker(input: FindPatternWorkerInput, budgetMs: number): Promise<SearchOutcome> {
  return new Promise((resolvePromise, rejectPromise) => {
    const matches: PatternMatch[] = [];
    let skippedLines = 0;
    let settled = false;
    const worker = new Worker(resolveWorkerPath(), { workerData: input });

    const finish = (timedOut: boolean, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) rejectPromise(error);
      else resolvePromise({ matches, skippedLines, timedOut });
    };

    const timer = setTimeout(() => finish(true), budgetMs);

    worker.on('message', (msg: FindPatternWorkerMessage) => {
      if (settled) return;
      switch (msg.type) {
        case 'match':
          if (matches.length < input.topK) matches.push(msg.match);
          break;
        case 'skipped':
          skippedLines += msg.count;
          break;
        case 'done':
          finish(false);
          break;
        case 'error':
          finish(false, new Error(msg.message));
          break;
      }
    });
    worker.on('error', (err) => finish(false, err));
    worker.on('exit', () => finish(false));
  });
}

function invalidInput(message: string) {
  return {
    content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, message)) }],
    isError: true,
  };
}

export function registerFindPatternTool(server: McpServer, config: HesmanConfig): void {
  const handler: ToolHandler = async (args) => {
    const started = Date.now();
    const pattern = args.pattern as string;
    const language = args.language as string;
    const filePattern = args.filePattern as string | undefined;
    const topK = intArg(args, 'topK', { default: 20, min: 1, max: 100 });

    // --- Validation ---
    if (!pattern || typeof pattern !== 'string') return invalidInput('pattern is required');
    if (!language || typeof language !== 'string') return invalidInput('language is required');
    if (filePattern !== undefined && typeof filePattern !== 'string') {
      return invalidInput('filePattern must be a string');
    }

    const limitError = validatePattern(pattern);
    if (limitError) return invalidInput(limitError);

    // --- Compile pattern to regex ---
    let regexSource: string;
    try {
      regexSource = compilePattern(pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return invalidInput(`Invalid pattern: ${message}`);
    }

    // The directory walk runs inside the worker too, so a large tree never
    // blocks the main thread; it counts against the same time budget.
    const outcome = await searchInWorker(
      {
        projectRoot: config.projectRoot,
        scanConfig: { ...config, languages: [language] },
        filePattern,
        regexSource,
        topK,
      },
      MATCH_TIME_BUDGET_MS,
    );

    const reasons: string[] = [];
    if (outcome.timedOut) {
      reasons.push(`search stopped after the ${MATCH_TIME_BUDGET_MS}ms time budget; results are partial`);
    }
    if (outcome.skippedLines > 0) {
      reasons.push(`${outcome.skippedLines} line(s) longer than ${MAX_LINE_LENGTH} characters were skipped`);
    }
    const truncated = reasons.length > 0;

    const compressed = compressToolResponse(
      'find_pattern',
      {
        matches: outcome.matches,
        totalFound: outcome.matches.length,
        // Files of a language without a grammar are searched as plain text.
        ...(isLanguageId(language) ? {} : { precision: 'text' }),
        truncated,
        ...(truncated ? { truncatedReason: reasons.join('; ') } : {}),
        tookMs: Date.now() - started,
      },
      {},
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(compressed),
        },
      ],
    };
  };

  server.registerTool('find_pattern', DESCRIPTION, inputSchema, withArgValidation(handler));
}
