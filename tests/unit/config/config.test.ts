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
    expect(defaultConfig.semanticSearch.embeddingModel).toBe('Xenova/all-MiniLM-L6-v2');
    expect(defaultConfig.semanticSearch.enabled).toBe(true);
    expect(defaultConfig.semanticSearch.defaultTopK).toBe(10);
    expect(defaultConfig.semanticSearch.maxTopK).toBe(50);
    expect(defaultConfig.semanticSearch.minScore).toBe(0.0);
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

describe('grammars.offline', () => {
  const withEnv = <T>(value: string | undefined, run: () => T): T => {
    const previous = process.env.HESMAN_GRAMMARS_OFFLINE;
    if (value === undefined) delete process.env.HESMAN_GRAMMARS_OFFLINE;
    else process.env.HESMAN_GRAMMARS_OFFLINE = value;
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env.HESMAN_GRAMMARS_OFFLINE;
      else process.env.HESMAN_GRAMMARS_OFFLINE = previous;
    }
  };

  it('is off by default: grammars are downloaded automatically (ADR 0001, section 10)', () => {
    expect(defaultConfig.grammars).toEqual({ offline: false });
    expect(HesmanConfigSchema.parse({}).grammars).toEqual({ offline: false });
    expect(withEnv(undefined, () => loadConfig()).grammars.offline).toBe(false);
  });

  it('is turned on by HESMAN_GRAMMARS_OFFLINE=1 or true, and off by 0', () => {
    expect(withEnv('1', () => loadConfig()).grammars.offline).toBe(true);
    expect(withEnv('true', () => loadConfig()).grammars.offline).toBe(true);
    expect(withEnv('0', () => loadConfig()).grammars.offline).toBe(false);
  });

  it('can be set in the config', () => {
    expect(HesmanConfigSchema.parse({ grammars: { offline: true } }).grammars.offline).toBe(true);
  });
});
