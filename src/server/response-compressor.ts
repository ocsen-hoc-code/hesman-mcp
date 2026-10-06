import { compactCode } from '../parsers/compact-mode.js';
import type { SqliteStore } from '../stores/sqlite.js';

interface CompressOptions {
  store?: SqliteStore;
  level?: 1 | 2;
  /** Pre-pipeline token count (before pruning/line-range extraction).
   *  When set, _meta.reduction compares against this baseline
   *  instead of the input data size, reflecting the full pipeline. */
  originalTokens?: number;
  /** Compact code content (Layer 1). Default true; `get_context` passes false for `mode: "full"`. */
  compact?: boolean;
}

// Tools that should not be compressed
const NO_COMPRESS = new Set(['index_status']);

// Tools that get _summary with byKind/byFile
const LIST_TOOLS = new Set(['get_references', 'list_dependencies', 'get_file_structure']);

// Tools that get call chain compression
const CHAIN_TOOLS = new Set(['get_callers', 'get_callees']);

// Tools with code content to compact
const CODE_TOOLS = new Set(['get_context']);

export function compressToolResponse(
  toolName: string,
  data: any,
  options?: CompressOptions,
): any {
  if (NO_COMPRESS.has(toolName)) return data;

  const result = { ...data };
  const level = options?.level ?? 1;

  // Layer 1: Compact any code content
  if (CODE_TOOLS.has(toolName) && options?.compact !== false && typeof result.content === 'string') {
    result.content = compactCode(result.content, { level });
  }

  // Compact any snippets within list results
  if (result.symbols) {
    result.symbols = result.symbols.map((s: any) => ({
      ...s,
      signature: s.signature || null,
    }));
  }

  // Add _summary for list tools
  if (LIST_TOOLS.has(toolName) && result.references) {
    const byKind: Record<string, number> = {};
    const byFile: Record<string, number> = {};
    for (const ref of result.references) {
      byKind[ref.kind] = (byKind[ref.kind] || 0) + 1;
      byFile[ref.filePath] = (byFile[ref.filePath] || 0) + 1;
    }
    (result as any)._summary = {
      totalCount: result.totalCount,
      byKind,
      byFile: Object.entries(byFile).map(([filePath, count]) => ({ filePath, count })),
    };
  }

  // Add _summary for dependency tools
  if (LIST_TOOLS.has(toolName) && result.dependencies) {
    const byKind: Record<string, number> = {};
    for (const dep of result.dependencies) {
      byKind[dep.kind] = (byKind[dep.kind] || 0) + 1;
    }
    (result as any)._summary = { totalCount: result.dependencies.length, byKind };
  }

  // Add _summary for file structure
  if (toolName === 'get_file_structure' && result.symbols) {
    const byKind: Record<string, number> = {};
    for (const s of result.symbols) {
      byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    }
    (result as any)._summary = { totalSymbols: result.symbols.length, byKind };
  }

  // Add _summary for call chain tools
  if (CHAIN_TOOLS.has(toolName)) {
    const entries = result.callers || result.callees || [];
    const direct = entries.filter((e: any) => e.depth === 1).length;
    const transitive = entries.length - direct;
    const files = new Set(entries.map((e: any) => e.filePath)).size;
    const uniqueFilePaths = [...new Set(entries.map((e: any) => e.filePath))];
    (result as any)._summary = {
      totalCount: entries.length,
      directCount: direct,
      transitiveCount: transitive,
      files,
      paths: uniqueFilePaths,
      summary: `${entries.length} entries (${direct} direct, ${transitive} transitive) across ${files} files`,
    };
  }

  // Never return something larger than the plain payload: if compaction and
  // _summary did not shrink the response, drop them and return `data` as-is.
  const plainTokens = estimateTokens(JSON.stringify(data));
  const candidateTokens = estimateTokens(JSON.stringify(result));
  const compressed = candidateTokens < plainTokens;
  const output = compressed ? result : { ...data };
  const outputTokens = compressed ? candidateTokens : plainTokens;

  // Baseline: the plain payload, or the pre-pipeline size (e.g. the full file
  // before pruning) when that is larger. Taking the max guarantees the output
  // never exceeds the baseline, so reduction is never negative.
  const pipelineBaseline = Math.max(plainTokens, options?.originalTokens ?? 0);
  const reduction = pipelineBaseline > 0
    ? `${(Math.max(0, 1 - outputTokens / pipelineBaseline) * 100).toFixed(1)}%`
    : '0.0%';

  // Determine which layers were active
  const layers: string[] = [];
  if (compressed && CODE_TOOLS.has(toolName)) layers.push('compact');
  if (compressed && (LIST_TOOLS.has(toolName) || CHAIN_TOOLS.has(toolName))) layers.push('summary');
  if (options?.originalTokens !== undefined && options.originalTokens > plainTokens) layers.push('prune');

  (output as any)._meta = {
    originalTokens: pipelineBaseline,
    compressedTokens: outputTokens,
    reduction,
    compressed,
    layers,
  };

  return output;
}

export function estimateTokens(text: string): number {
  // Rough estimate: 4 chars ≈ 1 token for code
  return Math.ceil(text.length / 4);
}
