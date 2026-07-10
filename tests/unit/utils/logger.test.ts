import { describe, it, expect } from 'vitest';
import { createLogger } from '../../../src/utils/logger';

describe('createLogger', () => {
  it('returns a logger with the given name', () => {
    const log = createLogger('test');
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.warn).toBe('function');
  });

  it('respects HESMAN_LOG_LEVEL env var', () => {
    process.env.HESMAN_LOG_LEVEL = 'debug';
    const log = createLogger('test-debug');
    expect(log.level).toBe('debug');
    delete process.env.HESMAN_LOG_LEVEL;
  });
});
