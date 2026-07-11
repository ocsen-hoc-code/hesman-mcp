import type { SqliteStore, CallerResult, CalleeResult } from '../stores/sqlite.js';

export interface SymbolSummary {
  signature: string;
  doc?: string;
  bodyOutline?: {
    totalLines: number;
    firstLines: string;
    lastLines: string;
    keyControlFlow: string[];
  };
  calls: { name: string; symbolId?: string; line: number; count: number }[];
  returnType?: string;
  complexity: {
    lines: number;
    params: number;
    callCount: number;
    nestingDepth: number;
  };
}

export interface CompressedChain {
  paths: string[];
  directCount: number;
  transitiveCount: number;
  summary: string;
}

export async function summarizeSymbol(
  symbolId: string,
  store: SqliteStore,
  options?: { maxBodyLines?: number; includeCalls?: boolean; includeControlFlow?: boolean },
): Promise<SymbolSummary> {
  const symbol = store.getSymbolById(symbolId);
  if (!symbol) throw new Error(`Symbol not found: ${symbolId}`);

  const includeCalls = options?.includeCalls ?? true;

  // Count parameters from signature
  const sigMatch = symbol.signature?.match(/\(([^)]*)\)/);
  const paramCount = sigMatch ? sigMatch[1].split(',').filter(p => p.trim()).length : 0;

  // Get callees for call list
  let calls: SymbolSummary['calls'] = [];
  if (includeCalls) {
    try {
      const callees = store.getCallees(symbolId, 1, 100);
      const callCounts = new Map<string, { symbolId?: string; name: string; line: number; count: number }>();
      for (const c of callees) {
        const existing = callCounts.get(c.name);
        if (existing) {
          existing.count++;
        } else {
          callCounts.set(c.name, { symbolId: c.symbolId, name: c.name, line: c.callSite.line, count: 1 });
        }
      }
      calls = Array.from(callCounts.values());
    } catch {
      // Relations table may not have callee data
    }
  }

  const bodyLines = symbol.end_line - symbol.start_line + 1;

  // Extract return type from signature
  let returnType: string | undefined;
  const retMatch = symbol.signature?.match(/\):\s*(\S+)/);
  if (retMatch) returnType = retMatch[1];

  return {
    signature: symbol.signature || `${symbol.kind} ${symbol.name}()`,
    doc: symbol.doc_comment || undefined,
    complexity: {
      lines: bodyLines,
      params: paramCount,
      callCount: calls.reduce((sum, c) => sum + c.count, 0),
      nestingDepth: 0, // Requires AST analysis — deferred
    },
    calls,
    returnType,
  };
}

export function compressCallChain(
  entries: (CallerResult | CalleeResult)[],
  maxDepth: number,
): CompressedChain {
  const direct = entries.filter(e => e.depth === 1);
  const transitive = entries.filter(e => e.depth > 1);
  const fileSet = new Set(entries.map(e => e.filePath));

  // Build paths from entries sorted by depth
  const depthGroups = new Map<number, typeof entries>();
  for (const e of entries) {
    const group = depthGroups.get(e.depth) || [];
    group.push(e);
    depthGroups.set(e.depth, group);
  }

  const paths: string[] = [];
  for (let d = 1; d <= maxDepth; d++) {
    const group = depthGroups.get(d) || [];
    if (group.length > 0) {
      const names = group.map(e => `${e.name}()`).join(', ');
      paths.push(`depth ${d}: ${names}`);
    }
  }

  return {
    paths,
    directCount: direct.length,
    transitiveCount: transitive.length,
    summary: `${entries.length} callers (${direct.length} direct, ${transitive.length} transitive) across ${fileSet.size} files`,
  };
}
