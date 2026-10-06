import { compressToolResponse } from '../response-compressor.js';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { HesmanConfig } from '../../config/schema.js';
import { ErrorCode, formatError } from '../error-codes.js';
import { intArg, withArgValidation } from '../args.js';
import { readFileSync } from 'node:fs';
import { scanProject } from '../../indexing/project-scanner.js';
import picomatch from 'picomatch';

const inputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description:
        'Structural pattern like console.$METHOD($$$ARGS). Use $NAME for word capture, $$$ARGS for greedy capture.',
    },
    language: { type: 'string', description: 'Language to search in (e.g. "typescript")' },
    filePattern: { type: 'string', description: 'Glob filter to restrict which files to search' },
    topK: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 20, max 100)' },
  },
  required: ['pattern', 'language'],
};

/**
 * Compile a user-friendly structural pattern into a RegExp.
 *
 * Syntax:
 *   $NAME      → named capture group matching \w+ (word characters)
 *   $$$ARGS    → named capture group matching .+  (greedy, any characters)
 *
 * The pipeline escapes all regex special characters first, then
 * selectively un-escapes the $NAME / $$$ARGS placeholders.
 */
function compilePattern(pattern: string): RegExp {
  // 1. Escape all regex special characters
  let regex = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 2. $$$NAME → greedy named capture (must be done before $NAME)
  regex = regex.replace(/\\\$\\\$\\\$(\w+)/g, '(?<$1>.+)');

  // 3. $NAME → word named capture
  regex = regex.replace(/\\\$(\w+)/g, '(?<$1>\\w+)');

  return new RegExp(regex, 'g');
}

export function registerFindPatternTool(server: McpServer, config: HesmanConfig): void {
  const handler: ToolHandler = async (args) => {
    const pattern = args.pattern as string;
    const language = args.language as string;
    const filePattern = args.filePattern as string | undefined;
    const topK = intArg(args, 'topK', { default: 20, min: 1, max: 100 });

    // --- Validation ---
    if (!pattern || typeof pattern !== 'string') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'pattern is required')),
          },
        ],
        isError: true,
      };
    }

    if (!language || typeof language !== 'string') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, 'language is required')),
          },
        ],
        isError: true,
      };
    }

    // --- Compile pattern to regex ---
    let compiled: RegExp;
    try {
      compiled = compilePattern(pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              formatError(ErrorCode.INVALID_INPUT, `Invalid pattern: ${message}`),
            ),
          },
        ],
        isError: true,
      };
    }

    const matches: Array<{
      filePath: string;
      line: number;
      snippet: string;
      bindings: Record<string, string>;
    }> = [];

    // Build a scan config for the requested language only
    const scanConfig = { ...config, languages: [language] };

    // Compile glob filter if filePattern provided
    const isMatch = filePattern ? picomatch(filePattern) : null;

    const files = scanProject(config.projectRoot, scanConfig);

    for (const file of files) {
      if (matches.length >= topK) break;

      // Apply file glob filter
      if (isMatch && !isMatch(file.filePath)) continue;

      // Read file contents
      let source: string;
      try {
        source = readFileSync(file.filePath, 'utf-8');
      } catch {
        // Skip files that can't be read as text
        continue;
      }

      const lines = source.split('\n');
      let m: RegExpExecArray | null;

      while ((m = compiled.exec(source)) !== null && matches.length < topK) {
        // Calculate 0-based line number
        const line = source.substring(0, m.index).split('\n').length - 1;

        // Extract named capture groups
        const bindings: Record<string, string> = {};
        if (m.groups) {
          for (const [key, value] of Object.entries(m.groups)) {
            bindings[key] = value;
          }
        }

        // Context snippet: 2 lines before and 2 lines after
        const snippetStart = Math.max(0, line - 2);
        const snippetEnd = Math.min(lines.length, line + 3);

        matches.push({
          filePath: file.filePath,
          line,
          snippet: lines.slice(snippetStart, snippetEnd).join('\n'),
          bindings,
        });
      }
    }

    const compressed = compressToolResponse('find_pattern', { matches, totalFound: matches.length, tookMs: 0 }, {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(compressed),
        },
      ],
    };
  };

  server.registerTool(
    'find_pattern',
    'Search code by structural pattern with named captures ($NAME for word tokens, $$$ARGS for greedy capture)',
    inputSchema,
    withArgValidation(handler),
  );
}
