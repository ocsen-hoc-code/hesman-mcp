import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../utils/logger';
import { formatError, ErrorCode } from './error-codes';
import type { MetricsCollector } from '../diagnostics/metrics';

const log = createLogger('mcp-server');

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text?: string }> }>;

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: object;
  handler: ToolHandler;
}

export class McpServer {
  private server: Server;
  private tools: RegisteredTool[] = [];
  private metrics?: MetricsCollector;

  constructor(name: string, version: string) {
    this.server = new Server(
      { name, version },
      { capabilities: { tools: {} } },
    );
  }

  setMetrics(metrics: MetricsCollector): void {
    this.metrics = metrics;
  }

  registerTool(
    name: string,
    description: string,
    inputSchema: object,
    handler: ToolHandler,
  ): void {
    this.tools.push({ name, description, inputSchema, handler });
    log.debug({ name }, 'Tool registered');
  }

  async connect(): Promise<void> {
    // Register request handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request: CallToolRequest) => {
        const tool = this.tools.find((t) => t.name === request.params.name);
        if (!tool) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  formatError(ErrorCode.INVALID_INPUT, `Unknown tool: ${request.params.name}`),
                ),
              },
            ],
            isError: true,
          };
        }

        try {
          const args = (request.params.arguments ?? {}) as Record<string, unknown>;
          const startTime = performance.now();
          const result = await tool.handler(args);
          const tookMs = performance.now() - startTime;
          if (this.metrics) {
            this.metrics.recordQuery(tookMs);
          }
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ tool: tool.name, error: message }, 'Tool handler error');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(formatError(ErrorCode.INTERNAL_ERROR, message)),
              },
            ],
            isError: true,
          };
        }
      },
    );

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log.info('MCP server connected via stdio');
  }

  async close(): Promise<void> {
    await this.server.close();
    log.info('MCP server closed');
  }
}
