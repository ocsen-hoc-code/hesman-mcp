import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createLogger } from '../utils/logger';
import type { HesmanConfig } from '../config/schema';

const log = createLogger('scanner');

/** Mapping from file extension to language ID */
const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
};

/** Patterns to always skip */
const ALWAYS_IGNORE = new Set([
  'node_modules',
  '.git',
  '.hesman',
  'dist',
  '.next',
  '.nuxt',
  '.output',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  'coverage',
  '.nyc_output',
]);

export interface ScannedFile {
  filePath: string;
  language: string;
  extension: string;
}

export function detectLanguage(filePath: string, config: HesmanConfig): string | null {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  const lang = EXTENSION_MAP[ext];
  if (!lang) return null;
  if (config.languages.includes('*')) return lang;
  if (config.languages.includes(lang)) return lang;
  return null;
}

export function scanProject(rootDir: string, config: HesmanConfig): ScannedFile[] {
  const results: ScannedFile[] = [];
  const absRoot = resolve(rootDir);
  const gitignorePatterns = loadGitignore(absRoot);

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);

      // Skip always-ignored directories
      if (ALWAYS_IGNORE.has(entry)) continue;
      // Skip dotfiles/dirs (except .env files)
      if (entry.startsWith('.') && entry !== '.env') continue;

      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }

      const relPath = relative(absRoot, fullPath);

      // Check gitignore patterns
      if (isIgnored(relPath, gitignorePatterns)) continue;
      // Check user-defined ignore patterns
      if (isIgnored(relPath, config.ignore ?? [])) continue;

      if (st.isDirectory()) {
        walk(fullPath);
      } else if (st.isFile()) {
        // Skip files over size limit
        if (st.size > config.maxFileSizeBytes) {
          log.debug({ file: relPath, size: st.size }, 'Skipping large file');
          continue;
        }

        const language = detectLanguage(entry, config);
        if (language) {
          results.push({
            filePath: fullPath,
            language,
            extension: entry.slice(entry.lastIndexOf('.')),
          });
        }
      }
    }
  }

  walk(absRoot);
  log.info({ fileCount: results.length }, 'Project scan complete');
  return results;
}

function loadGitignore(rootDir: string): string[] {
  const gitignorePath = join(rootDir, '.gitignore');
  if (!existsSync(gitignorePath)) return [];
  try {
    const content = readFileSync(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

function isIgnored(relPath: string, patterns: string[]): boolean {
  // Simple glob matching for common patterns
  for (const pattern of patterns) {
    if (pattern.endsWith('/') && relPath.startsWith(pattern)) return true;
    if (pattern.startsWith('**/') && relPath.includes(pattern.slice(3))) return true;
    if (relPath === pattern) return true;
    if (relPath.startsWith(pattern.replace('/*', '/'))) return true;
  }
  return false;
}
