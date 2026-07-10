import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createLogger } from '../utils/logger';
import type { HesmanConfig } from '../config/schema';
import type { SqliteStore } from '../stores/sqlite';
import { scanProject } from './project-scanner';
import { parseFile, initParser, type ExtractedSymbol } from '../parsers/core';
import { tsProfile } from '../parsers/profiles/typescript';
import type { LanguageProfile } from '../parsers/language-profile';

const log = createLogger('index-coordinator');

export interface IndexResult {
  filesScanned: number;
  filesIndexed: number;
  symbolsFound: number;
  errors: string[];
  tookMs: number;
}

const PROFILE_BY_LANG: Record<string, LanguageProfile> = {
  typescript: tsProfile,
};

export async function indexProject(
  rootDir: string,
  store: SqliteStore,
  config: HesmanConfig,
): Promise<IndexResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  // Scan for files
  const files = scanProject(rootDir, config);

  // Pre-initialize parser for languages we'll encounter
  const languages = new Set(files.map((f) => f.language));
  for (const lang of languages) {
    const profile = PROFILE_BY_LANG[lang];
    if (profile) await initParser(profile);
  }

  let filesIndexed = 0;
  let symbolsFound = 0;

  for (const file of files) {
    try {
      const profile = PROFILE_BY_LANG[file.language];
      if (!profile) continue;

      // Check if file changed
      const content = readFileSync(file.filePath, 'utf-8');
      const sha256 = createHash('sha256').update(content).digest('hex');
      const previousHash = store.getFileHash(file.filePath);

      if (previousHash === sha256) {
        // File unchanged — skip
        continue;
      }

      // Parse file
      const result = await parseFile(file.filePath, profile);

      // Clear old symbols and insert new
      store.clearSymbols(file.filePath);

      if (result.symbols.length > 0) {
        const now = Date.now();
        const rows = result.symbols.map((s: ExtractedSymbol) => ({
          ...s,
          updated_at: now,
        }));
        store.upsertSymbols(rows);
      }

      // Update file hash
      store.upsertFileHash(file.filePath, sha256);

      filesIndexed++;
      symbolsFound += result.symbols.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ file: file.filePath, error: message }, 'Failed to index file');
      errors.push(`${file.filePath}: ${message}`);
    }
  }

  const tookMs = Date.now() - startTime;
  log.info(
    { filesScanned: files.length, filesIndexed, symbolsFound, errors: errors.length, tookMs },
    'Index complete',
  );

  return {
    filesScanned: files.length,
    filesIndexed,
    symbolsFound,
    errors,
    tookMs,
  };
}
