import { defaultConfig } from './defaults';
import { HesmanConfigSchema, type HesmanConfig } from './schema';

export function loadConfig(): HesmanConfig {
  // Phase 1: hardcoded defaults only (config file + CLI flags in Phase 4)
  const raw: Record<string, unknown> = { ...defaultConfig };

  // Environment variable overrides
  if (process.env.HESMAN_PROJECT_ROOT) {
    raw.projectRoot = process.env.HESMAN_PROJECT_ROOT;
  }
  if (process.env.HESMAN_WORKERS) {
    raw.workers = parseInt(process.env.HESMAN_WORKERS, 10);
  }
  if (process.env.HESMAN_LOG_LEVEL) {
    raw.logLevel = process.env.HESMAN_LOG_LEVEL;
  }
  if (process.env.HESMAN_DATA_DIR) {
    raw.dataDir = process.env.HESMAN_DATA_DIR;
  }

  return HesmanConfigSchema.parse(raw);
}
