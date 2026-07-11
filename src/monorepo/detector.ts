import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createLogger } from '../utils/logger';

const log = createLogger('monorepo-detector');

export interface PackageInfo {
  name: string;
  path: string;
  relativePath: string;
}

export interface WorkspaceInfo {
  type: 'pnpm' | 'lerna' | 'nx' | 'turbo' | 'npm' | null;
  root: string;
  packages: PackageInfo[];
}

const MAX_TRAVERSAL_DEPTH = 100;

/**
 * Detect a monorepo workspace by walking up from startDir until we find
 * a workspace marker file (pnpm-workspace.yaml, lerna.json, nx.json,
 * turbo.json) or a package.json with a "workspaces" field.
 *
 * Returns null if no workspace is found before hitting a .git directory
 * or the filesystem root.
 */
export function detectWorkspace(startDir: string): WorkspaceInfo | null {
  let dir = resolve(startDir);
  let iterations = 0;

  while (dir !== dirname(dir)) {
    iterations++;
    if (iterations > MAX_TRAVERSAL_DEPTH) {
      log.warn('detectWorkspace: exceeded max directory traversal depth, aborting');
      return null;
    }

    // Check pnpm-workspace.yaml
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return parsePnpmWorkspace(dir);
    }

    // Check lerna.json
    if (existsSync(join(dir, 'lerna.json'))) {
      return parseLernaWorkspace(dir);
    }

    // Check nx.json
    if (existsSync(join(dir, 'nx.json'))) {
      return parseNxWorkspace(dir);
    }

    // Check turbo.json
    if (existsSync(join(dir, 'turbo.json'))) {
      return parseTurboWorkspace(dir);
    }

    // npm workspaces via package.json
    if (existsSync(join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        // Only treat as workspace root if workspaces field is present
        if (pkg.workspaces && Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0) {
          return parseNpmWorkspace(dir, pkg.workspaces);
        }
        // Also support workspaces.packages array (npm v7+ object form)
        if (pkg.workspaces && typeof pkg.workspaces === 'object' && Array.isArray(pkg.workspaces.packages)) {
          return parseNpmWorkspace(dir, pkg.workspaces.packages);
        }
      } catch {
        // Ignore invalid package.json, continue walking
      }
    }

    // Stop at .git — this is the root of a single project, not a workspace root
    if (existsSync(join(dir, '.git'))) {
      return null;
    }

    dir = dirname(dir);
  }

  return null;
}

/**
 * Parse a pnpm-workspace.yaml file.
 * Uses line-by-line regex parsing to avoid needing a YAML dependency.
 */
function parsePnpmWorkspace(root: string): WorkspaceInfo {
  const filePath = join(root, 'pnpm-workspace.yaml');
  const content = readFileSync(filePath, 'utf-8');
  const packages: string[] = [];

  const lines = content.split('\n');
  let inPackagesSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('packages:')) {
      inPackagesSection = true;
      // Check for inline array like packages: ["a", "b"]
      const inlineMatch = line.match(/packages:\s*\[(.*)\]/);
      if (inlineMatch && inlineMatch[1]) {
        const items = inlineMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
        for (const item of items) {
          if (item) packages.push(item);
        }
      }
      continue;
    }

    if (inPackagesSection) {
      // If line is indented with a dash, it's a list item
      const listMatch = rawLine.match(/^\s*-\s*(.+)$/);
      if (listMatch) {
        const item = listMatch[1].trim().replace(/['"]/g, '');
        if (item) packages.push(item);
      } else if (!rawLine.startsWith('#') && rawLine.trim() !== '') {
        // If we hit a non-empty, non-comment, non-list line, we've left the packages section
        inPackagesSection = false;
      }
    }
  }

  return buildWorkspaceInfo('pnpm', root, packages);
}

/**
 * Parse a lerna.json file.
 */
function parseLernaWorkspace(root: string): WorkspaceInfo {
  const filePath = join(root, 'lerna.json');
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    log.warn({ root }, 'Failed to read lerna.json');
    return buildWorkspaceInfo('lerna', root, []);
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content);
  } catch {
    log.warn({ root }, 'Invalid lerna.json');
    return buildWorkspaceInfo('lerna', root, []);
  }

  const packages: string[] = [];
  const raw = config.packages;

  if (Array.isArray(raw)) {
    packages.push(...raw.map(String));
  } else if (typeof raw === 'string') {
    packages.push(raw);
  }

  return buildWorkspaceInfo('lerna', root, packages);
}

/**
 * Parse an nx.json file.
 */
function parseNxWorkspace(root: string): WorkspaceInfo {
  const filePath = join(root, 'nx.json');
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    log.warn({ root }, 'Failed to read nx.json');
    return buildWorkspaceInfo('nx', root, []);
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content);
  } catch {
    log.warn({ root }, 'Invalid nx.json');
    return buildWorkspaceInfo('nx', root, []);
  }

  const packages: string[] = [];

  // nx.json can define workspaceLayout (or use npm workspaces)
  const wsLayout = config.workspaceLayout as Record<string, unknown> | undefined;
  if (wsLayout) {
    const appsDir = typeof wsLayout.appsDir === 'string' ? wsLayout.appsDir : 'apps';
    const libsDir = typeof wsLayout.libsDir === 'string' ? wsLayout.libsDir : 'libs';
    packages.push(`${appsDir}/*`, `${libsDir}/*`);
  }

  // Check if there's an implicit npm-style workspaces config
  const knownNxPatterns = ['packages/*', 'apps/*', 'libs/*'];
  for (const pat of knownNxPatterns) {
    const fullPath = join(root, pat.replace(/\*$/, ''));
    if (existsSync(fullPath) && !packages.includes(pat)) {
      packages.push(pat);
    }
  }

  return buildWorkspaceInfo('nx', root, packages);
}

/**
 * Parse a turbo.json file.
 */
function parseTurboWorkspace(root: string): WorkspaceInfo {
  const filePath = join(root, 'turbo.json');
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    log.warn({ root }, 'Failed to read turbo.json');
    return buildWorkspaceInfo('turbo', root, []);
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content);
  } catch {
    log.warn({ root }, 'Invalid turbo.json');
    return buildWorkspaceInfo('turbo', root, []);
  }

  const packages: string[] = [];

  // Turbo repos commonly use npm-style workspaces, check package.json
  if (existsSync(join(root, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
      if (Array.isArray(pkg.workspaces)) {
        packages.push(...pkg.workspaces.map(String));
      } else if (pkg.workspaces && typeof pkg.workspaces === 'object' && Array.isArray(pkg.workspaces.packages)) {
        packages.push(...pkg.workspaces.packages.map(String));
      }
    } catch {
      // ignore
    }
  }

  // Remove duplicates
  const unique = [...new Set(packages)];
  return buildWorkspaceInfo('turbo', root, unique);
}

/**
 * Parse an npm-style workspace from a package.json workspaces field.
 */
function parseNpmWorkspace(root: string, workspaces: string[]): WorkspaceInfo {
  return buildWorkspaceInfo('npm', root, workspaces);
}

/**
 * Convert glob patterns into resolved PackageInfo objects.
 *
 * Handles simple glob patterns:
 *   - "packages/*" -> enumerate directories under packages/
 *   - "packages/pkg-a" -> literal path
 *   - "packages/**" -> one level deep under packages/
 *
 * For each matched directory, looks for a package.json to extract the package name.
 */
function buildWorkspaceInfo(
  type: WorkspaceInfo['type'],
  root: string,
  globPatterns: string[],
): WorkspaceInfo {
  const resolvedPackages: PackageInfo[] = [];

  for (const pattern of globPatterns) {
    const expanded = expandGlobPattern(root, pattern);
    for (const relativePath of expanded) {
      const absPath = join(root, relativePath);
      if (!existsSync(absPath)) continue;

      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      // Try to find package.json to get package name
      let name = relativePath.split('/').pop() || relativePath;
      try {
        const pkgPath = join(absPath, 'package.json');
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          name = pkg.name || name;
        }
      } catch {
        // Use folder name as fallback
      }

      // Avoid duplicates
      if (!resolvedPackages.some((p) => p.path === absPath)) {
        resolvedPackages.push({
          name,
          path: absPath,
          relativePath,
        });
      }
    }
  }

  return { type, root, packages: resolvedPackages };
}

/**
 * Expand a glob pattern to concrete relative paths.
 *
 * Supports:
 *   - Literal paths (e.g., "packages/pkg-a")
 *   - Single-level wildcard (e.g., "packages/*" -> enumerate subdirectories)
 *   - Double-wildcard at end (e.g., "packages/**" -> one level subdirectories)
 *   - Mixed segments with one wildcard (e.g., "libs/{asterisk}/utils")
 */
function expandGlobPattern(root: string, pattern: string): string[] {
  const results: string[] = [];

  // Literal path (no wildcard) — return as-is, let caller verify existence
  if (!pattern.includes('*')) {
    results.push(pattern);
    return results;
  }

  const parts = pattern.split('/');
  const wildcardIdx = parts.findIndex((p) => p.includes('*'));

  if (wildcardIdx === -1) {
    results.push(pattern);
    return results;
  }

  const baseParts = parts.slice(0, wildcardIdx);
  const suffixParts = parts.slice(wildcardIdx + 1);
  const baseDir = join(root, ...baseParts);

  if (!existsSync(baseDir)) return results;

  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryPath = join(baseDir, entry);
    let stat;
    try {
      stat = statSync(entryPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    // Skip hidden directories
    if (entry.startsWith('.')) continue;

    if (suffixParts.length === 0) {
      // Simple wildcard like packages/*
      results.push([...baseParts, entry].join('/'));
    } else {
      // Handle one level deeper (e.g., packages/*/utils)
      const subBaseDir = join(baseDir, entry);
      let subEntries: string[];
      try {
        subEntries = readdirSync(subBaseDir);
      } catch {
        continue;
      }
      for (const subEntry of subEntries) {
        const subEntryPath = join(subBaseDir, subEntry);
        let subStat;
        try {
          subStat = statSync(subEntryPath);
        } catch {
          continue;
        }
        if (!subStat.isDirectory()) continue;
        if (subEntry.startsWith('.')) continue;
        results.push([...baseParts, entry, ...suffixParts.slice(1), subEntry].join('/'));
      }
    }
  }

  return results;
}
