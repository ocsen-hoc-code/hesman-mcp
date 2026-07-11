import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexProject, type IndexResult } from '../indexing/index-coordinator';
import type { SqliteStore } from '../stores/sqlite';
import type { ZVecStore } from '../stores/zvec';
import type { WorkerPool } from '../indexing/worker-pool';
import type { HesmanConfig } from '../config/schema';
import type { WorkspaceInfo } from './detector';
import { createLogger } from '../utils/logger';

const log = createLogger('monorepo-coordinator');

export interface PackageIndexResult {
  name: string;
  path: string;
  relativePath: string;
  result: IndexResult;
  crossPackageRelations: number;
}

export interface WorkspaceIndexResult {
  workspace: WorkspaceInfo;
  packages: PackageIndexResult[];
  totalFiles: number;
  totalSymbols: number;
  totalErrors: number;
  crossPackageRelations: number;
  tookMs: number;
}

/**
 * Index all packages in a monorepo workspace.
 *
 * Each package is indexed independently into the same SQLite store.
 * After all packages are indexed, cross-package relations are discovered
 * by resolving import dependencies between packages.
 *
 * @param workspace - The detected workspace info
 * @param store - Shared SQLite store for all package symbols
 * @param config - Hesman configuration
 * @param zvecStore - Optional vector store for semantic search
 * @param pool - Optional worker pool for parallel indexing
 */
export async function indexWorkspace(
  workspace: WorkspaceInfo,
  store: SqliteStore,
  config: HesmanConfig,
  zvecStore?: ZVecStore,
  pool?: WorkerPool,
): Promise<WorkspaceIndexResult> {
  const startTime = Date.now();
  const packageResults: PackageIndexResult[] = [];

  let totalFiles = 0;
  let totalSymbols = 0;
  let totalErrors = 0;

  // Index each package independently
  for (const pkg of workspace.packages) {
    log.info({ package: pkg.name, path: pkg.path }, 'Indexing workspace package');

    const pkgConfig: HesmanConfig = {
      ...config,
      projectRoot: pkg.path,
    };

    const result = await indexProject(pkg.path, store, pkgConfig, zvecStore, pool);

    totalFiles += result.filesIndexed;
    totalSymbols += result.symbolsFound;
    totalErrors += result.errors.length;

    packageResults.push({
      name: pkg.name,
      path: pkg.path,
      relativePath: pkg.relativePath,
      result,
      crossPackageRelations: 0, // filled in below
    });
  }

  // Discover cross-package relations
  const crossPackageRelations = await discoverCrossPackageRelations(
    workspace,
    packageResults,
    store,
  );

  // Update cross-package relation counts per package
  for (const pkgResult of packageResults) {
    pkgResult.crossPackageRelations = countRelationsForPackage(
      pkgResult.path,
      crossPackageRelations,
    );
  }

  const tookMs = Date.now() - startTime;
  log.info(
    {
      packages: packageResults.length,
      totalFiles,
      totalSymbols,
      crossPackageRelations: crossPackageRelations.length,
      tookMs,
    },
    'Workspace indexing complete',
  );

  return {
    workspace,
    packages: packageResults,
    totalFiles,
    totalSymbols,
    totalErrors,
    crossPackageRelations: crossPackageRelations.length,
    tookMs,
  };
}

/**
 * Discover relations between symbols across different packages.
 *
 * This scans unresolved/package import relations and tries to match
 * them against symbols defined in other packages of the workspace.
 *
 * Returns the list of newly inserted cross-package relation rows.
 */
async function discoverCrossPackageRelations(
  workspace: WorkspaceInfo,
  packageResults: PackageIndexResult[],
  store: SqliteStore,
): Promise<Array<{ fromFile: string; toSymbolId: string; kind: string }>> {
  const crossRelations: Array<{ fromFile: string; toSymbolId: string; kind: string }> = [];
  const packagePaths = new Set(workspace.packages.map((p) => p.path));

  for (const pkgResult of packageResults) {
    if (pkgResult.result.errors.length > 0) continue;

    // Get all import dependencies for this package
    const dependencies = store.getDependencies(undefined, 'imports');

    // Filter dependencies that point to other packages
    const unresolvedDeps = dependencies.filter(
      (dep) => dep.kind === 'unresolved' || dep.kind === 'package',
    );

    for (const dep of unresolvedDeps) {
      // Try to find the symbol in other packages
      const candidates = store.getSymbolsByName(dep.target, undefined, undefined, 5, 'exact');
      for (const candidate of candidates) {
        // Check if this candidate belongs to a different package
        const candidatePkgPath = findPackageForPath(candidate.file_path, packagePaths);
        if (candidatePkgPath && candidatePkgPath !== pkgResult.path) {
          // Found a cross-package relation
          crossRelations.push({
            fromFile: pkgResult.path,
            toSymbolId: candidate.id,
            kind: 'imports',
          });
        }
      }
    }
  }

  return crossRelations;
}

/**
 * Find which package a file path belongs to.
 */
function findPackageForPath(
  filePath: string,
  packagePaths: Set<string>,
): string | null {
  for (const pkgPath of packagePaths) {
    if (filePath.startsWith(pkgPath + '/') || filePath.startsWith(pkgPath + '\\')) {
      return pkgPath;
    }
  }
  return null;
}

/**
 * Count how many cross-package relations involve the given package path.
 */
function countRelationsForPackage(
  pkgPath: string,
  relations: Array<{ fromFile: string; toSymbolId: string; kind: string }>,
): number {
  return relations.filter((r) => r.fromFile === pkgPath).length;
}
