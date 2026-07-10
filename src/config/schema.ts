import { z } from 'zod';

export const HesmanConfigSchema = z.object({
  projectRoot: z.string().default('.'),
  ignore: z.array(z.string()).default([]),
  maxFileSizeBytes: z.number().positive().default(2_097_152),
  languages: z.array(z.string()).default(['*']),
  indexOnStartup: z.boolean().default(true),
  workers: z.number().int().min(0).default(0),
  batchSize: z.number().int().positive().default(50),
  watchMode: z.boolean().default(true),
  embeddingModel: z.string().default('all-MiniLM-L6-v2'),
  embeddingCacheDir: z.string().default(''),
  semanticSearch: z
    .object({
      defaultTopK: z.number().int().positive().default(10),
      maxTopK: z.number().int().positive().default(50),
      hybridWeight: z
        .object({ dense: z.number().min(0).max(1).default(0.6), sparse: z.number().min(0).max(1).default(0.4) })
        .default({}),
    })
    .default({}),
  maxMemoryMB: z.number().positive().default(350),
  cacheSize: z.number().int().positive().default(2000),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  logFile: z.string().nullable().default(null),
  dataDir: z.string().default('.hesman'),
  autoCleanDataDir: z.boolean().default(false),
});

export type HesmanConfig = z.infer<typeof HesmanConfigSchema>;
