import type { HesmanConfig } from './schema.js';

export const defaultConfig: HesmanConfig = {
  projectRoot: '.',
  ignore: [],
  maxFileSizeBytes: 2_097_152, // 2MB
  languages: ['*'],
  indexOnStartup: true,
  workers: 0, // auto
  batchSize: 50,
  watchMode: true,
  maxMemoryMB: 350,
  cacheSize: 2000,
  semanticSearch: {
    enabled: true,
    defaultTopK: 10,
    maxTopK: 50,
    minScore: 0.0,
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    embeddingCacheDir: '',
  },
  logLevel: 'info',
  logFile: null,
  dataDir: '.hesman',
  autoCleanDataDir: false,
  grammars: { offline: false },
};
