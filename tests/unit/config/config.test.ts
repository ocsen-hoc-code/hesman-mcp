import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../../../src/config/defaults';
import { HesmanConfigSchema } from '../../../src/config/schema';
import { loadConfig } from '../../../src/config/loader';

describe('defaultConfig', () => {
  it('has all required fields', () => {
    expect(defaultConfig.projectRoot).toBe('.');
    expect(defaultConfig.dataDir).toBe('.hesman');
    expect(defaultConfig.maxFileSizeBytes).toBe(2097152);
    expect(defaultConfig.logLevel).toBe('info');
    expect(defaultConfig.workers).toBe(0);
    expect(defaultConfig.batchSize).toBe(50);
    expect(defaultConfig.languages).toEqual(['*']);
    expect(defaultConfig.watchMode).toBe(true);
    expect(defaultConfig.indexOnStartup).toBe(true);
    expect(defaultConfig.cacheSize).toBe(2000);
    expect(defaultConfig.maxMemoryMB).toBe(350);
    expect(defaultConfig.embeddingModel).toBe('all-MiniLM-L6-v2');
  });

  it('passes zod validation', () => {
    const result = HesmanConfigSchema.safeParse(defaultConfig);
    expect(result.success).toBe(true);
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config file or env vars', () => {
    const config = loadConfig();
    expect(config.projectRoot).toBe('.');
    expect(config.dataDir).toBe('.hesman');
  });
});
