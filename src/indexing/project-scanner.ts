import { readdirSync, lstatSync, readFileSync, existsSync, type Stats } from 'node:fs';
import { basename, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { createLogger } from '../utils/logger.js';
import type { HesmanConfig } from '../config/schema.js';
import { languageForPath } from '../parsers/languages.js';
import { textLanguageForPath } from '../parsers/text-languages.js';
import { readTextSample, textFileSkipReason } from './text-file-filter.js';

const log = createLogger('scanner');

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

/**
 * How a file is indexed:
 * - `parsed` — its language has a grammar in the registry: symbols and relations.
 * - `text`   — no grammar: line-range chunks only (see `text-file-filter.ts`
 *              for which files qualify). `language` is then a text-tier label.
 */
export type FileTier = 'parsed' | 'text';

export interface ScannedFile {
  filePath: string;
  language: string;
  extension: string;
  tier: FileTier;
}

function languageEnabled(language: string, config: HesmanConfig): boolean {
  return config.languages.includes('*') || config.languages.includes(language);
}

export function detectLanguage(filePath: string, config: HesmanConfig): string | null {
  const lang = languageForPath(filePath);
  if (!lang) return null;
  return languageEnabled(lang, config) ? lang : null;
}

/** True for entries the walk never descends into or lists, whatever the ignore files say. */
export function isAlwaysSkipped(entry: string): boolean {
  // Always-ignored directories, and dotfiles/dirs (except .env files)
  return ALWAYS_IGNORE.has(entry) || (entry.startsWith('.') && entry !== '.env');
}

/**
 * Classifies one regular file that passed the path rules: the parsed tier when
 * its language has a grammar, otherwise the text tier when the file qualifies
 * as text source, otherwise `null` (not indexed).
 */
function classifyFile(fullPath: string, entry: string, st: Stats, relPath: string, config: HesmanConfig): ScannedFile | null {
  // Skip files over size limit
  if (st.size > config.maxFileSizeBytes) {
    log.debug({ file: relPath, size: st.size }, 'Skipping large file');
    return null;
  }
  const dot = entry.lastIndexOf('.');
  const extension = dot === -1 ? '' : entry.slice(dot);

  if (languageForPath(entry)) {
    // A grammar exists: the file is parsed or, when its language is filtered out, not indexed at all.
    const language = detectLanguage(entry, config);
    return language ? { filePath: fullPath, language, extension, tier: 'parsed' } : null;
  }

  const language = textLanguageForPath(entry);
  if (!languageEnabled(language, config)) return null;
  let reason: string | null;
  try {
    reason = textFileSkipReason(entry, st.size, () => readTextSample(fullPath));
  } catch {
    reason = 'unreadable';
  }
  if (reason) {
    log.debug({ file: relPath, reason }, 'Not indexing file as text');
    return null;
  }
  return { filePath: fullPath, language, extension, tier: 'text' };
}

/**
 * Classifies a single path with the rules of `scanProject`, for callers that
 * learn about files one at a time (the file watcher). Returns `null` when the
 * walk would not list the file: outside the root, under an ignored or dot
 * directory, a symlink, not a regular file, too large, or not indexable.
 */
export function scanFile(rootDir: string, filePath: string, config: HesmanConfig): ScannedFile | null {
  const absRoot = resolve(rootDir);
  const fullPath = resolve(filePath);
  const relPath = relative(absRoot, fullPath);
  if (relPath === '' || relPath.startsWith('..') || isAbsolute(relPath)) return null;

  const gitignorePatterns = loadGitignore(absRoot);
  const segments = relPath.split(sep);
  let current = absRoot;
  let st: Stats | undefined;
  for (const segment of segments) {
    if (isAlwaysSkipped(segment)) return null;
    current = join(current, segment);
    try {
      st = lstatSync(current);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) return null;
    const rel = relative(absRoot, current);
    if (isIgnored(rel, gitignorePatterns) || isIgnored(rel, config.ignore ?? [])) return null;
  }
  if (!st?.isFile()) return null;
  return classifyFile(fullPath, basename(fullPath), st, relPath, config);
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

      if (isAlwaysSkipped(entry)) continue;

      let st;
      try {
        // lstat (not stat) so symlinks are seen as links rather than followed.
        st = lstatSync(fullPath);
      } catch {
        continue;
      }

      const relPath = relative(absRoot, fullPath);

      // Skip every symlink (file or directory). Following them risks infinite
      // recursion (`loop -> .`), indexing code outside the project, and
      // duplicate symbols for files reachable through more than one path.
      if (st.isSymbolicLink()) {
        log.debug({ path: relPath }, 'Skipping symlink');
        continue;
      }

      // Check gitignore patterns
      if (isIgnored(relPath, gitignorePatterns)) continue;
      // Check user-defined ignore patterns
      if (isIgnored(relPath, config.ignore ?? [])) continue;

      if (st.isDirectory()) {
        walk(fullPath);
      } else if (st.isFile()) {
        const scanned = classifyFile(fullPath, entry, st, relPath, config);
        if (scanned) results.push(scanned);
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
