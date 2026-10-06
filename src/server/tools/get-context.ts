import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { McpServer, ToolHandler } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import { compactCode } from '../../parsers/compact-mode.js';
import { compressToolResponse, estimateTokens } from '../response-compressor.js';
import { ErrorCode, formatError } from '../error-codes.js';
import { intArg, withArgValidation } from '../args.js';

const MAX_LINE = 10_000_000;
const MAX_CONTEXT_LINES = 200;

const inputSchema = {
  type: 'object',
  properties: {
    filePath: { type: 'string', description: 'Absolute or relative file path' },
    startLine: { type: 'integer', minimum: 1, maximum: MAX_LINE, description: 'Focus line number (1-indexed)' },
    endLine: { type: 'integer', minimum: 1, maximum: MAX_LINE, description: 'End line (default: same as startLine; values below startLine are raised to startLine)' },
    contextLines: { type: 'integer', minimum: 0, maximum: MAX_CONTEXT_LINES, description: 'Lines of context above and below (default: 5, max 200)' },
    mode: { type: 'string', enum: ['compact', 'full'], description: 'Compact mode strips comments and blank lines (default: compact)' },
    symbolName: { type: 'string', description: 'Optional — return symbols in range' },
  },
  required: ['filePath', 'startLine'],
};

export function registerGetContextTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async (args) => {
    const filePath = args.filePath as string;
    const startLine = intArg(args, 'startLine', { default: 1, min: 1, max: MAX_LINE });
    const endLine = intArg(args, 'endLine', { default: startLine, min: startLine, max: MAX_LINE });
    const contextLines = intArg(args, 'contextLines', { default: 5, min: 0, max: MAX_CONTEXT_LINES });
    const mode = (args.mode as string) || 'compact';

    if (!existsSync(filePath)) {
      return { content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.FILE_NOT_FOUND, `File not found: ${filePath}`)) }], isError: true };
    }

    const source = readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');
    const totalLines = lines.length;

    // Capture full-file token count as pipeline baseline (before pruning)
    const fullFileTokens = estimateTokens(source);

    // Calculate range with context
    const fromLine = Math.max(1, startLine - contextLines);
    const toLine = Math.min(totalLines, (endLine || startLine) + contextLines);

    // Extract content
    let content = lines.slice(fromLine - 1, toLine).join('\n');

    // Apply compact mode
    if (mode === 'compact') {
      content = compactCode(content, { level: 1 });
    }

    // Find symbols in range
    const symbolsInRange: any[] = [];
    try {
      const allSymbols = store.getSymbolsByFile(filePath);
      for (const s of allSymbols) {
        if (s.start_line <= toLine && s.end_line >= fromLine) {
          symbolsInRange.push({
            id: s.id,
            name: s.name,
            kind: s.kind,
            startLine: s.start_line,
            endLine: s.end_line,
          });
        }
      }
    } catch {
      // Symbol lookup is best-effort
    }

    // Detect language
    const ext = extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript', '.js': 'typescript', '.jsx': 'typescript',
      '.py': 'python', '.go': 'go',
    };
    const language = langMap[ext] || 'unknown';

    const result = {
      filePath,
      startLine: fromLine,
      endLine: toLine,
      content,
      language,
      totalLines,
      symbolsInRange,
    };
    const compressed = compressToolResponse('get_context', result, { store, originalTokens: fullFileTokens });
    return {
      content: [{ type: 'text', text: JSON.stringify(compressed) }],
    };
  };

  server.registerTool('get_context', 'Get surrounding code at a location with optional compact mode', inputSchema, withArgValidation(handler));
}
