import type { HesmanConfig } from './schema';

export const defaultConfig: HesmanConfig = {
  projectRoot: '.',
  ignore: [],
  maxFileSizeBytes: 2_097_152, // 2MB
  languages: ['*'],
  indexOnStartup: true,
  workers: 0, // auto
  batchSize: 50,
  watchMode: true,
  embeddingModel: 'all-MiniLM-L6-v2',
  embeddingCacheDir: '',
  semanticSearch: {
    defaultTopK: 10,
    maxTopK: 50,
    hybridWeight: { dense: 0.6, sparse: 0.4 },
  },
  maxMemoryMB: 350,
  cacheSize: 2000,
  logLevel: 'info',
  logFile: null,
  dataDir: '.hesman',
  autoCleanDataDir: false,
};
