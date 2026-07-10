import type { McpServer } from '../mcp-server';
import type { SqliteStore } from '../../stores/sqlite';
import { registerFindSymbolTool } from './find-symbol';
import { registerGetFileStructureTool } from './get-file-structure';
import { registerIndexStatusTool } from './index-status';

export function registerAllTools(server: McpServer, store: SqliteStore): void {
  registerFindSymbolTool(server, store);
  registerGetFileStructureTool(server, store);
  registerIndexStatusTool(server, store);
}
