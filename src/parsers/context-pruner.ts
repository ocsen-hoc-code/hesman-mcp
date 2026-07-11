import type { SqliteStore } from '../stores/sqlite';

export interface PruneOptions {
  _maxOutputLines?: number;        // default 50 (reserved for future use)
  includeCallers?: boolean;       // default true
  includeCallees?: boolean;       // default true
  includeReferences?: boolean;    // default false
}

export interface PrunedSection {
  startLine: number;
  endLine: number;
  reason: string;
}

export interface PrunedResult {
  content: string;
  keptLines: number;
  totalLines: number;
  prunedSections: PrunedSection[];
}

export async function pruneContext(
  source: string,
  filePath: string,
  focusSymbolId: string,
  store: SqliteStore,
  options: PruneOptions = {},
): Promise<PrunedResult> {
  const _maxOutputLines = options._maxOutputLines ?? 50;
  const includeCallers = options.includeCallers ?? true;
  const includeCallees = options.includeCallees ?? true;
  const includeReferences = options.includeReferences ?? false;

  const lines = source.split('\n');
  const totalLines = lines.length;

  // Get focus symbol info
  const focusSymbol = store.getSymbolById(focusSymbolId);
  if (!focusSymbol) {
    throw new Error(`Symbol not found: ${focusSymbolId}`);
  }

  // Collect relevant line ranges
  const relevantRanges: Array<[number, number]> = [];
  const relevantReasons = new Map<string, string>();

  // 1. Focus symbol itself
  const focusStart = focusSymbol.start_line;
  const focusEnd = focusSymbol.end_line;
  const focusSize = focusEnd - focusStart + 1;

  // Include doc comment lines above the focus symbol
  if (focusSymbol.doc_comment) {
    const docLineCount = focusSymbol.doc_comment.split('\n').length;
    const docStart = Math.max(1, focusStart - docLineCount - 1);
    if (docStart < focusStart) {
      relevantRanges.push([docStart, focusStart - 1]);
      relevantReasons.set(`${docStart}-${focusStart - 1}`, 'doc comment');
    }
  }

  if (focusSize <= 20) {
    relevantRanges.push([focusStart, focusEnd]);
  } else {
    // Keep signature + first 3 lines + last 3 lines
    relevantRanges.push([focusStart, focusStart + 3]);
    relevantRanges.push([focusEnd - 3, focusEnd]);
  }
  relevantReasons.set(`${focusStart}-${focusEnd}`, 'focus symbol');

  // 2. Direct callees (symbols called by focus within this file)
  if (includeCallees) {
    const callees = store.getCallees(focusSymbolId, 1, 50);
    for (const callee of callees) {
      if (callee.filePath === filePath) {
        relevantRanges.push([callee.startLine, callee.startLine]); // signature only
        relevantReasons.set(`${callee.startLine}`, `callee: ${callee.name}`);
      }
    }
  }

  // 3. Direct callers (symbols calling focus within this file)
  if (includeCallers) {
    const callers = store.getCallers(focusSymbolId, 1, 50);
    for (const caller of callers) {
      if (caller.filePath === filePath) {
        // Keep call site line + 2 context lines
        const callLine = caller.callSite.line;
        relevantRanges.push([Math.max(1, callLine - 2), Math.min(totalLines, callLine + 2)]);
        relevantReasons.set(`${callLine}`, `caller: ${caller.name}`);
      }
    }
  }

  // 4. References (within file)
  if (includeReferences) {
    const { refs } = store.getReferences(focusSymbolId);
    for (const ref of refs) {
      if (ref.filePath === filePath) {
        relevantRanges.push([Math.max(1, ref.line - 1), ref.line + 1]);
      }
    }
  }

  // Merge overlapping ranges
  const merged = mergeRanges(relevantRanges);

  // Build output: iterate lines, keep if in relevant range
  const kept: string[] = [];
  const prunedSections: PrunedSection[] = [];
  let currentPruneStart = 0;
  let currentPruneReason = '';

  for (let i = 1; i <= totalLines; i++) {
    const inRange = merged.some(([s, e]) => i >= s && i <= e);
    if (inRange) {
      // Flush any pending pruned section
      if (currentPruneStart > 0) {
        const count = i - currentPruneStart;
        kept.push(`// ... (${count} lines omitted${currentPruneReason ? ': ' + currentPruneReason : ''})`);
        prunedSections.push({ startLine: currentPruneStart, endLine: i - 1, reason: currentPruneReason || 'unrelated code' });
        currentPruneStart = 0;
        currentPruneReason = '';
      }
      kept.push(lines[i - 1]);
    } else {
      if (currentPruneStart === 0) {
        currentPruneStart = i;
        // Determine reason
        const trimmed = lines[i - 1].trim();
        if (trimmed.startsWith('import ')) currentPruneReason = 'unused import';
        else if (trimmed.startsWith('class ')) currentPruneReason = 'unrelated class';
        else if (trimmed.startsWith('function ')) currentPruneReason = 'unrelated function';
        else currentPruneReason = '';
      }
    }
  }
  // Flush trailing pruned section
  if (currentPruneStart > 0) {
    const count = totalLines - currentPruneStart + 1;
    kept.push(`// ... (${count} lines omitted${currentPruneReason ? ': ' + currentPruneReason : ''})`);
    prunedSections.push({ startLine: currentPruneStart, endLine: totalLines, reason: currentPruneReason || 'unrelated code' });
  }

  return {
    content: kept.join('\n'),
    keptLines: kept.filter(l => !l.startsWith('// ...')).length,
    totalLines,
    prunedSections,
  };
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1] + 1) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}
