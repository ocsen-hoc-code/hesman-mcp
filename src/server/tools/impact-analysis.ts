import type { McpServer, ToolHandler } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';
import { compressToolResponse } from '../response-compressor';
import { ErrorCode, formatError } from '../error-codes';

const inputSchema = {
  type: 'object',
  properties: {
    symbolId: { type: 'string', description: 'Symbol ID to analyze' },
    changeType: { type: 'string', enum: ['rename', 'change_signature', 'delete', 'change_return_type'] },
    newName: { type: 'string', description: 'New name (if rename)' },
    newSignature: { type: 'string', description: 'New signature (if change_signature)' },
    newReturnType: { type: 'string', description: 'New return type (if change_return_type)' },
    maxFiles: { type: 'number', description: 'Max impacted files in output (default 20)' },
  },
  required: ['symbolId', 'changeType'],
};

function classifySeverity(kind: string): 'must_fix' | 'should_review' | 'info' {
  switch (kind) {
    case 'calls':
    case 'extends':
    case 'implements':
      return 'must_fix';
    case 'references':
      return 'should_review';
    case 'imports':
      return 'info';
    default:
      return 'should_review';
  }
}

function suggestAction(changeType: string, kind: string, oldName: string, newName?: string, newSignature?: string, newReturnType?: string): string {
  switch (changeType) {
    case 'rename':
      return `rename ${kind === 'calls' ? 'function call' : kind === 'imports' ? 'import' : 'reference'} from '${oldName}' to '${newName || '<new_name>'}'`;
    case 'change_signature':
      return `update arguments to match new signature: ${newSignature || '<new_signature>'}`;
    case 'delete':
      return `remove this ${kind === 'calls' ? 'call' : kind === 'imports' ? 'import' : 'reference'} to '${oldName}'`;
    case 'change_return_type':
      return `update type annotation to ${newReturnType || '<new_return_type>'}`;
    default:
      return `update reference to '${oldName}'`;
  }
}

export function registerImpactAnalysisTool(server: McpServer, store: SqliteStore): void {
  const handler: ToolHandler = async (args) => {
    const symbolId = args.symbolId as string;
    const changeType = args.changeType as string;
    const newName = args.newName as string | undefined;
    const newSignature = args.newSignature as string | undefined;
    const newReturnType = args.newReturnType as string | undefined;
    const maxFiles = (args.maxFiles as number) || 20;

    // Get symbol info
    const symbol = store.getSymbolById(symbolId);
    if (!symbol) {
      return { content: [{ type: 'text', text: JSON.stringify(formatError(ErrorCode.SYMBOL_NOT_FOUND, `Symbol not found: ${symbolId}`)) }], isError: true };
    }

    // Get all references
    const { refs } = store.getReferences(symbolId, undefined, 200);

    // Group by file and severity
    const fileMap = new Map<string, {
      filePath: string;
      severity: 'must_fix' | 'should_review' | 'info';
      reasons: string[];
      locations: any[];
    }>();

    for (const ref of refs) {
      const severity = classifySeverity(ref.kind);
      let entry = fileMap.get(ref.filePath);
      if (!entry) {
        entry = { filePath: ref.filePath, severity, reasons: [], locations: [] };
        fileMap.set(ref.filePath, entry);
      }
      // Upgrade severity if any location is higher
      const sevOrder = ['info', 'should_review', 'must_fix'] as const;
      if (sevOrder.indexOf(severity) > sevOrder.indexOf(entry.severity)) {
        entry.severity = severity;
      }

      const action = suggestAction(changeType, ref.kind, symbol.name, newName, newSignature, newReturnType);
      entry.locations.push({
        line: ref.line,
        col: ref.col,
        kind: ref.kind,
        action,
        currentCode: ref.callerName ? `${ref.callerName}()` : '(unknown)',
      });
    }

    // Sort: must_fix first, then by file count
    const impactedFiles = Array.from(fileMap.values())
      .sort((a, b) => {
        const sevOrder = ['must_fix', 'should_review', 'info'];
        return sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity);
      })
      .slice(0, maxFiles)
      .map(f => ({
        ...f,
        reason: `${f.locations.length} ${f.locations[0]?.kind || 'reference'}(s) — ${f.severity === 'must_fix' ? 'will break' : f.severity === 'should_review' ? 'may need update' : 'FYI'}`,
      }));

    const mustFix = impactedFiles.filter(f => f.severity === 'must_fix').length;
    const shouldReview = impactedFiles.filter(f => f.severity === 'should_review').length;
    const info = impactedFiles.filter(f => f.severity === 'info').length;

    const result = {
      symbol: { id: symbol.id, name: symbol.name, kind: symbol.kind, filePath: symbol.file_path, signature: symbol.signature },
      changeType,
      _summary: {
        totalFiles: fileMap.size,
        mustFix,
        shouldReview,
        info,
        estimatedChanges: refs.length,
      },
      impactedFiles,
    };
    const compressed = compressToolResponse('impact_analysis', result, { store });
    return {
      content: [{ type: 'text', text: JSON.stringify(compressed) }],
    };
  };

  server.registerTool('impact_analysis', 'Analyze what breaks if a symbol changes — categorized by severity with suggested actions', inputSchema, handler);
}
