import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../utils/logger.js';
import { formatError, ErrorCode } from './error-codes.js';
import type { MetricsCollector } from '../diagnostics/metrics.js';
import type { ToolCallRecorder } from '../diagnostics/tool-call-log.js';

const log = createLogger('mcp-server');

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text?: string }> }>;

/** Result of a tool call: the handler's, or an error produced before it ran. */
export type ToolResult = Awaited<ReturnType<ToolHandler>> & { isError?: boolean };

/**
 * Runs before every tool call. Returning a result answers the call with it
 * instead of running the tool (e.g. while no project is selected).
 */
export type ToolCallGuard = () => Promise<ToolResult | undefined>;

/** A workspace folder reported by the client through `roots/list`. */
export interface ClientRoot {
  uri: string;
  name?: string;
}

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
  private recorder?: ToolCallRecorder;
  private guard?: ToolCallGuard;
  private clientReadyListener?: () => void;
  private clientReadySeen = false;
  private rootsChangedListener?: () => void;

  constructor(name: string, version: string) {
    this.server = new Server(
      { name, version },
      { capabilities: { tools: {} } },
    );
  }

  setMetrics(metrics: MetricsCollector | undefined): void {
    this.metrics = metrics;
  }

  /** Where finished tool calls are recorded (`diagnostics/tool-call-log.ts`); `undefined` stops recording. */
  setCallRecorder(recorder: ToolCallRecorder | undefined): void {
    this.recorder = recorder;
  }

  setToolCallGuard(guard: ToolCallGuard): void {
    this.guard = guard;
  }

  /**
   * Called once, when the client has finished the handshake and its
   * capabilities are known: on `notifications/initialized`, or on its first
   * request if it never sends that notification.
   */
  onClientReady(listener: () => void): void {
    this.clientReadyListener = listener;
  }

  /** Called on every `notifications/roots/list_changed` from the client. */
  onRootsChanged(listener: () => void): void {
    this.rootsChangedListener = listener;
  }

  /** Whether the client declared the `roots` capability. Only meaningful once the client is ready. */
  clientSupportsRoots(): boolean {
    return this.server.getClientCapabilities()?.roots !== undefined;
  }

  /**
   * Asks the client for its workspace folders. Rejects when the client does
   * not answer within `timeoutMs`, or when `signal` aborts.
   */
  async listRoots(options: { timeoutMs: number; signal?: AbortSignal }): Promise<ClientRoot[]> {
    const result = await this.server.listRoots(undefined, { timeout: options.timeoutMs, signal: options.signal });
    return result.roots;
  }

  private markClientReady(): void {
    if (this.clientReadySeen) return;
    this.clientReadySeen = true;
    this.clientReadyListener?.();
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

  /** The registered tools as `tools/list` reports them. */
  listTools(): Array<{ name: string; description: string; inputSchema: object }> {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  hasTool(name: string): boolean {
    return this.tools.some((t) => t.name === name);
  }

  /**
   * Runs one tool call exactly as `tools/call` does: unknown tools and thrown
   * errors become error results, the guard runs first, and the finished call
   * goes to the metrics and the call recorder. Never rejects. `hesman ui` calls
   * this directly, so both entry points share validation and error handling.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const startTime = performance.now();
    const result = await this.runTool(name, args);
    if (this.recorder) {
      try {
        this.recorder.record({ tool: name, args, durationMs: performance.now() - startTime, result });
      } catch {
        // Recording is best effort: it must never fail a call.
      }
    }
    return result;
  }

  private async runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formatError(ErrorCode.INVALID_INPUT, `Unknown tool: ${name}`)),
          },
        ],
        isError: true,
      };
    }

    try {
      const blocked = await this.guard?.();
      if (blocked) return blocked;

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
  }

  async connect(): Promise<void> {
    // Register request handlers
    this.server.oninitialized = () => this.markClientReady();
    this.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      this.rootsChangedListener?.();
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.markClientReady();
      return { tools: this.listTools() };
    });

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request: CallToolRequest) => {
        this.markClientReady();
        return this.callTool(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
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
