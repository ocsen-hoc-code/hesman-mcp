import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { defaultConfig } from './defaults.js';
import { HesmanConfigSchema, type HesmanConfig } from './schema.js';

/**
 * Walk up directories from startDir looking for hesman.config.json.
 * Stops at filesystem root or .git boundary.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);

  while (true) {
    // Stop at .git boundary (don't look above project root)
    if (existsSync(join(dir, '.git'))) {
      const configPath = join(dir, 'hesman.config.json');
      return existsSync(configPath) ? configPath : null;
    }

    const configPath = join(dir, 'hesman.config.json');
    if (existsSync(configPath)) return configPath;

    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw };

  if (process.env.HESMAN_PROJECT_ROOT) {
    result.projectRoot = process.env.HESMAN_PROJECT_ROOT;
  }
  if (process.env.HESMAN_WORKERS) {
    result.workers = parseInt(process.env.HESMAN_WORKERS, 10);
  }
  if (process.env.HESMAN_LOG_LEVEL) {
    result.logLevel = process.env.HESMAN_LOG_LEVEL;
  }
  if (process.env.HESMAN_DATA_DIR) {
    result.dataDir = process.env.HESMAN_DATA_DIR;
  }
  if (process.env.HESMAN_WATCH_MODE) {
    result.watchMode = process.env.HESMAN_WATCH_MODE === 'true' || process.env.HESMAN_WATCH_MODE === '1';
  }
  if (process.env.HESMAN_GRAMMARS_OFFLINE) {
    const offline = process.env.HESMAN_GRAMMARS_OFFLINE === 'true' || process.env.HESMAN_GRAMMARS_OFFLINE === '1';
    result.grammars = { ...(result.grammars as object | undefined), offline };
  }

  return result;
}

function parseCliFlagsToOverrides(args: string[]): Partial<HesmanConfig> {
  const overrides: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--project-root' && args[i + 1]) {
      overrides.projectRoot = args[++i];
    } else if (arg === '--workers' && args[i + 1]) {
      overrides.workers = parseInt(args[++i], 10);
    } else if (arg === '--log-level' && args[i + 1]) {
      overrides.logLevel = args[++i];
    } else if (arg === '--data-dir' && args[i + 1]) {
      overrides.dataDir = args[++i];
    } else if (arg === '--no-watch') {
      overrides.watchMode = false;
    } else if (arg === '--watch-mode' && args[i + 1]) {
      const v = args[++i];
      overrides.watchMode = v === 'true' || v === '1';
    } else if (arg === '--no-semantic') {
      overrides.semanticSearch = { enabled: false };
    } else if (arg === '--batch-size' && args[i + 1]) {
      overrides.batchSize = parseInt(args[++i], 10);
    }
  }

  return overrides as Partial<HesmanConfig>;
}

export function loadConfig(cliOverrides?: Partial<HesmanConfig>): HesmanConfig {
  // 1. Start from defaults
  let raw: Record<string, unknown> = { ...defaultConfig };

  // 2. Find and merge config file (if exists)
  const configPath = findConfigFile(process.cwd());
  if (configPath) {
    try {
      const fileContent = readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(fileContent);
      raw = { ...raw, ...fileConfig };
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Invalid JSON in ${configPath}: ${err.message}`);
      }
      throw err;
    }
  }

  // 3. Apply environment variable overrides
  raw = applyEnvOverrides(raw);

  // 4. Apply CLI flag overrides (highest priority)
  if (cliOverrides) {
    raw = { ...raw, ...cliOverrides };
  }

  // 5. Validate with Zod schema
  return HesmanConfigSchema.parse(raw);
}

// Re-export for CLI subcommands
export { parseCliFlagsToOverrides };
