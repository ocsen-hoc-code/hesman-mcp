import pino from 'pino';
import type { Logger } from 'pino';

export function createLogger(name: string): Logger {
  const level = process.env.HESMAN_LOG_LEVEL || 'info';
  return pino({
    name,
    level,
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });
}
