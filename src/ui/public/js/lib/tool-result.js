// Reads what the playground shows from a `POST /api/tools/:name` answer:
// `{ result: <tool JSON incl. _meta>, isError, durationMs }`. No DOM access.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseResult(result) {
  if (typeof result !== 'string') return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

export function summarizeToolRun(data) {
  const result = parseResult(data?.result);
  const meta = isObject(result) && isObject(result._meta) ? result._meta : null;
  const error = isObject(result) && isObject(result.error) ? result.error : null;
  let json = '';
  if (typeof result === 'string') json = result;
  else if (result !== undefined) json = JSON.stringify(result, null, 2);
  return {
    isError: data?.isError === true,
    durationMs: typeof data?.durationMs === 'number' ? data.durationMs : null,
    meta: meta
      ? {
          originalTokens: meta.originalTokens ?? null,
          compressedTokens: meta.compressedTokens ?? null,
          reduction: meta.reduction ?? null,
          compressed: meta.compressed ?? null,
          layers: Array.isArray(meta.layers) ? meta.layers : [],
        }
      : null,
    // Present only while the initial index runs: the answer came from a partial index.
    indexing: meta && isObject(meta.indexing) ? meta.indexing : null,
    error: error ? { code: String(error.code ?? ''), message: String(error.message ?? '') } : null,
    json,
  };
}
