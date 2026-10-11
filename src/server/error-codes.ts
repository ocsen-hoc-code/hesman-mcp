export const ErrorCode = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  SYMBOL_NOT_FOUND: 'SYMBOL_NOT_FOUND',
  INDEX_NOT_READY: 'INDEX_NOT_READY',
  INVALID_INPUT: 'INVALID_INPUT',
  PARSE_FAILED: 'PARSE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  STORE_LOCKED: 'STORE_LOCKED',
  WORKER_CRASHED: 'WORKER_CRASHED',
  EMBEDDING_FAILED: 'EMBEDDING_FAILED',
  PARTIAL_RESULTS: 'PARTIAL_RESULTS',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFIG_INVALID: 'CONFIG_INVALID',
  PATH_OUTSIDE_PROJECT: 'PATH_OUTSIDE_PROJECT',
  NO_PROJECT: 'NO_PROJECT',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export function formatError(code: ErrorCodeType, message: string, detail?: unknown) {
  return {
    error: {
      code,
      message,
      ...(detail !== undefined ? { detail } : {}),
    },
  };
}
