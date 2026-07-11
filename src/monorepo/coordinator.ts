import { indexProject, type IndexResult } from '../indexing/index-coordinator.js';
import type { SqliteStore } from '../stores/sqlite.js';
import type { ZVecStore } from '../stores/zvec.js';
import type { WorkerPool } from '../indexing/worker-pool.js';
import type { HesmanConfig } from '../config/schema.js';
import type { WorkspaceInfo } from './detector.js';
import { createLogger } from '../utils/logger.js';

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

  for (const pkgResult of packageResults) {
    if (pkgResult.result.errors.length > 0) continue;

    // Get all import dependencies for this package
    const dependencies = store.getDependencies(undefined, 'imports');

    // Filter dependencies that point to other packages
    const unresolvedDeps = dependencies.filter(
      (dep) => dep.kind === 'unresolved' || dep.kind === 'package',
    );

    // Build a map from package name to package path for matching
    const pkgNameToPath = new Map<string, string>();
    for (const pkg of workspace.packages) {
      pkgNameToPath.set(pkg.name, pkg.path);
    }

    for (const dep of unresolvedDeps) {
      // dep.target is a module path (e.g., '@monorepo/pkg-a', './utils')
      // Try to match it against workspace package names
      const matchedPkgPath = pkgNameToPath.get(dep.target);
      if (!matchedPkgPath || matchedPkgPath === pkgResult.path) continue;

      // Get all symbols from the matching package
      const pkgSymbols = store.getSymbolsByFile(matchedPkgPath);
      for (const sym of pkgSymbols.slice(0, 5)) {
        crossRelations.push({
          fromFile: pkgResult.path,
          toSymbolId: sym.id,
          kind: 'imports',
        });
      }
    }
  }

  return crossRelations;
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
