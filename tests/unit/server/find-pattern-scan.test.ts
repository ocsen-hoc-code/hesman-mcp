import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer, ToolHandler } from '../../../src/server/mcp-server.js';
import { defaultConfig } from '../../../src/config/defaults.js';

// The directory walk must run inside the find-pattern worker (which loads the
// compiled scanner from dist/), never on the main thread. Any main-thread call
// to scanProject fails the test.
const mainThreadScan = vi.hoisted(() => vi.fn());
vi.mock('../../../src/indexing/project-scanner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/indexing/project-scanner.js')>();
  return {
    ...actual,
    scanProject: (...args: Parameters<typeof actual.scanProject>) => {
      mainThreadScan(...args);
      return actual.scanProject(...args);
    },
  };
});

const { registerFindPatternTool } = await import('../../../src/server/tools/find-pattern.js');

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

interface FindPatternBody {
  matches: Array<{ filePath: string; line: number; bindings: Record<string, string> }>;
  totalFound: number;
  truncated: boolean;
}

function captureHandler(config: typeof defaultConfig): ToolHandler {
  let captured: ToolHandler | undefined;
  const server = {
    registerTool(_name: string, _description: string, _inputSchema: object, handler: ToolHandler) {
      captured = handler;
    },
  } as unknown as McpServer;
  registerFindPatternTool(server, config);
  if (!captured) throw new Error('find_pattern was not registered');
  return captured;
}

describe('find_pattern project scan', () => {
  let project: string;

  beforeEach(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-find-pattern-scan-')));
    mkdirSync(join(project, 'src'));
    mkdirSync(join(project, 'other'));
    writeFileSync(join(project, 'src', 'a.ts'), 'console.log("a");\n');
    writeFileSync(join(project, 'other', 'b.ts'), 'console.warn("b");\n');
    writeFileSync(join(project, 'src', 'c.py'), 'print("c")\n');
    mainThreadScan.mockClear();
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it('does not walk the project on the main thread', async () => {
    const handler = captureHandler({ ...defaultConfig, projectRoot: project });

    const result = (await handler({ pattern: 'console.$M($$$A)', language: 'typescript' })) as ToolResult;

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text ?? '{}') as FindPatternBody;
    expect(body.matches.map((m) => m.bindings.M).sort()).toEqual(['log', 'warn']);
    expect(mainThreadScan).not.toHaveBeenCalled();
  });

  it('applies language and filePattern filters inside the worker', async () => {
    const handler = captureHandler({ ...defaultConfig, projectRoot: project });

    const result = (await handler({
      pattern: 'console.$M($$$A)',
      language: 'typescript',
      filePattern: 'src/**/*.ts',
    })) as ToolResult;

    const body = JSON.parse(result.content[0].text ?? '{}') as FindPatternBody;
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].filePath).toBe(join(project, 'src', 'a.ts'));
    expect(mainThreadScan).not.toHaveBeenCalled();
  });

  it('returns no matches when no file matches the filters', async () => {
    const handler = captureHandler({ ...defaultConfig, projectRoot: project });

    const result = (await handler({
      pattern: 'console.$M($$$A)',
      language: 'typescript',
      filePattern: 'nowhere/**',
    })) as ToolResult;

    const body = JSON.parse(result.content[0].text ?? '{}') as FindPatternBody;
    expect(body.matches).toEqual([]);
    expect(body.truncated).toBe(false);
  });
});
