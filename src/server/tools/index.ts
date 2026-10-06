import type { McpServer } from '../mcp-server.js';
import type { SqliteStore } from '../../stores/sqlite.js';
import type { ZVecStore } from '../../stores/zvec.js';
import type { HesmanConfig } from '../../config/schema.js';
import { registerFindSymbolTool } from './find-symbol.js';
import { registerGetCalleesTool } from './get-callees.js';
import { registerGetCallersTool } from './get-callers.js';
import { registerGetFileStructureTool } from './get-file-structure.js';
import { registerGetReferencesTool } from './get-references.js';
import { registerIndexStatusTool } from './index-status.js';
import { registerSemanticSearchTool } from './semantic-search.js';
import { registerListDependenciesTool } from './list-dependencies.js';
import { registerFindPatternTool } from './find-pattern.js';
import { registerGetContextTool } from './get-context.js';
import { registerImpactAnalysisTool } from './impact-analysis.js';

export function registerAllTools(
  server: McpServer,
  store: SqliteStore,
  zvecStore: ZVecStore | undefined,
  config: HesmanConfig,
): void {
  registerFindSymbolTool(server, store, config);
  registerGetCalleesTool(server, store);
  registerGetCallersTool(server, store);
  registerGetFileStructureTool(server, store, config);
  registerGetReferencesTool(server, store);
  registerIndexStatusTool(server, store, zvecStore);
  registerListDependenciesTool(server, store, config);
  registerGetContextTool(server, store, config);
  registerImpactAnalysisTool(server, store);
  if (zvecStore) {
    registerSemanticSearchTool(server, zvecStore, config);
  }
  registerFindPatternTool(server, config);
}
