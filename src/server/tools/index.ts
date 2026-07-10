import type { McpServer } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';
import type { ZVecStore } from '../../stores/zvec';
import type { HesmanConfig } from '../../config/schema';
import { registerFindSymbolTool } from './find-symbol';
import { registerGetCalleesTool } from './get-callees';
import { registerGetCallersTool } from './get-callers';
import { registerGetFileStructureTool } from './get-file-structure';
import { registerGetReferencesTool } from './get-references';
import { registerIndexStatusTool } from './index-status';
import { registerSemanticSearchTool } from './semantic-search';

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
  if (zvecStore && config) {
    registerSemanticSearchTool(server, zvecStore, config);
  }
}
