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
  zvecStore?: ZVecStore,
  config?: HesmanConfig,
): void {
  registerFindSymbolTool(server, store);
  registerGetCalleesTool(server, store);
  registerGetCallersTool(server, store);
  registerGetFileStructureTool(server, store);
  registerGetReferencesTool(server, store);
  registerIndexStatusTool(server, store, zvecStore);
  registerListDependenciesTool(server, store);
  registerGetContextTool(server, store);
  registerImpactAnalysisTool(server, store);
  if (zvecStore && config) {
    registerSemanticSearchTool(server, zvecStore, config);
  }
  if (config) {
    registerFindPatternTool(server, config);
  }
}
