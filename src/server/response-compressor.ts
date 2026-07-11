import { compactCode } from '../parsers/compact-mode';
import type { SqliteStore } from '../stores/sqlite';

interface CompressOptions {
  store?: SqliteStore;
  level?: 1 | 2 | 3;
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
  if (CODE_TOOLS.has(toolName) && typeof result.content === 'string') {
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

  // Always add _meta
  const originalTokens = estimateTokens(JSON.stringify(data));
  const compressedTokens = estimateTokens(JSON.stringify(result));
  (result as any)._meta = {
    originalTokens,
    compressedTokens,
    reduction: originalTokens > 0
      ? `${((1 - compressedTokens / originalTokens) * 100).toFixed(1)}%`
      : '0%',
    layers: CODE_TOOLS.has(toolName) ? ['compact'] : [],
  };

  return result;
}

function estimateTokens(text: string): number {
  // Rough estimate: 4 chars ≈ 1 token for code
  return Math.ceil(text.length / 4);
}
