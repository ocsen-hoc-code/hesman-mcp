export const ErrorCode = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  SYMBOL_NOT_FOUND: 'SYMBOL_NOT_FOUND',
  INDEX_NOT_READY: 'INDEX_NOT_READY',
  INVALID_INPUT: 'INVALID_INPUT',
  PARSE_FAILED: 'PARSE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
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
