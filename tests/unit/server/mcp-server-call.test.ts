import { describe, expect, it } from 'vitest';
import { McpServer } from '../../../src/server/mcp-server';
import type { ToolCallInput } from '../../../src/diagnostics/tool-call-log';

const text = (payload: unknown): { content: Array<{ type: string; text: string }> } => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
});

function serverWithEcho(): McpServer {
  const server = new McpServer('test', '0.0.0');
  server.registerTool('echo', 'Echoes its arguments', { type: 'object', properties: {} }, async (args) => text({ args }));
  server.registerTool('boom', 'Always throws', { type: 'object' }, async () => {
    throw new Error('kaboom');
  });
  return server;
}

describe('McpServer.listTools', () => {
  it('lists the registered tools without their handlers', () => {
    expect(serverWithEcho().listTools()).toEqual([
      { name: 'echo', description: 'Echoes its arguments', inputSchema: { type: 'object', properties: {} } },
      { name: 'boom', description: 'Always throws', inputSchema: { type: 'object' } },
    ]);
  });

  it('says whether a tool exists', () => {
    const server = serverWithEcho();
    expect(server.hasTool('echo')).toBe(true);
    expect(server.hasTool('nope')).toBe(false);
  });
});

describe('McpServer.callTool', () => {
  it('runs the handler with the arguments', async () => {
    const result = await serverWithEcho().callTool('echo', { a: 1 });
    expect(JSON.parse(result.content[0].text ?? '')).toEqual({ args: { a: 1 } });
    expect(result.isError).toBeUndefined();
  });

  it('answers an unknown tool with INVALID_INPUT', async () => {
    const result = await serverWithEcho().callTool('nope', {});
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text ?? '').error.code).toBe('INVALID_INPUT');
  });

  it('turns a throwing handler into INTERNAL_ERROR', async () => {
    const result = await serverWithEcho().callTool('boom', {});
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text ?? '').error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'kaboom' });
  });

  it('answers with the guard result instead of running the tool', async () => {
    const server = serverWithEcho();
    server.setToolCallGuard(async () => ({ ...text({ error: { code: 'NO_PROJECT', message: 'none' } }), isError: true }));
    const result = await server.callTool('echo', {});
    expect(JSON.parse(result.content[0].text ?? '').error.code).toBe('NO_PROJECT');
  });
});

describe('McpServer call recording', () => {
  it('hands every finished call to the recorder: tool, arguments, duration and result', async () => {
    const server = serverWithEcho();
    const recorded: ToolCallInput[] = [];
    server.setCallRecorder({ record: (call) => recorded.push(call) });

    const result = await server.callTool('echo', { name: 'greet' });
    await server.callTool('boom', {});
    await server.callTool('nope', { x: 1 });

    expect(recorded.map((r) => r.tool)).toEqual(['echo', 'boom', 'nope']);
    expect(recorded[0].args).toEqual({ name: 'greet' });
    expect(recorded[0].result).toBe(result);
    expect(recorded[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(recorded[1].result.isError).toBe(true);
    expect(recorded[2].result.isError).toBe(true);
  });

  it('records calls answered by the guard', async () => {
    const server = serverWithEcho();
    const recorded: ToolCallInput[] = [];
    server.setCallRecorder({ record: (call) => recorded.push(call) });
    server.setToolCallGuard(async () => ({ ...text({ error: { code: 'NO_PROJECT', message: 'none' } }), isError: true }));

    await server.callTool('echo', {});
    expect(recorded).toHaveLength(1);
    expect(recorded[0].result.isError).toBe(true);
  });

  it('returns the tool result even when the recorder throws', async () => {
    const server = serverWithEcho();
    server.setCallRecorder({
      record: () => {
        throw new Error('disk full');
      },
    });

    const result = await server.callTool('echo', { a: 1 });
    expect(JSON.parse(result.content[0].text ?? '')).toEqual({ args: { a: 1 } });
  });

  it('records nothing once the recorder is removed', async () => {
    const server = serverWithEcho();
    const recorded: ToolCallInput[] = [];
    server.setCallRecorder({ record: (call) => recorded.push(call) });
    server.setCallRecorder(undefined);

    await server.callTool('echo', {});
    expect(recorded).toHaveLength(0);
  });
});
