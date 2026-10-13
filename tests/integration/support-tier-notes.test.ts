/**
 * Graph tools say when a language has no call extraction (M1-06), instead of
 * answering with an empty list that reads as "nobody calls this". Run through
 * the real tool handlers on a project with a deep language (TypeScript), an
 * on-demand structural language (R, grammar installed from the committed
 * release asset) and a text-tier file (Markdown).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { copyFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexProject } from '../../src/indexing/index-coordinator';
import { SqliteStore } from '../../src/stores/sqlite';
import { defaultConfig } from '../../src/config/defaults';
import { configureGrammarStore, grammarStore } from '../../src/parsers/grammar-store';
import { textChunkId } from '../../src/parsers/text-chunker';
import type { McpServer, ToolHandler } from '../../src/server/mcp-server';
import { registerGetCallersTool } from '../../src/server/tools/get-callers';
import { registerGetCalleesTool } from '../../src/server/tools/get-callees';
import { registerGetReferencesTool } from '../../src/server/tools/get-references';
import { registerImpactAnalysisTool } from '../../src/server/tools/impact-analysis';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function captureTool(register: (server: McpServer) => void): ToolHandler {
  let captured: ToolHandler | undefined;
  register({
    registerTool(_name: string, _description: string, _schema: object, handler: ToolHandler) {
      captured = handler;
    },
  } as unknown as McpServer);
  if (!captured) throw new Error('tool was not registered');
  return captured;
}

interface Answer {
  note?: string;
  callers?: unknown[];
  callees?: unknown[];
  references?: unknown[];
  impactedFiles?: unknown[];
  error?: { code: string; message: string };
  _meta?: unknown;
}

describe('graph tools on languages without call extraction', () => {
  let root: string;
  let dataDir: string;
  let cacheRoot: string;
  let store: SqliteStore;
  let previousCacheDir: string | undefined;
  let tools: Record<'get_callers' | 'get_callees' | 'get_references' | 'impact_analysis', ToolHandler>;

  const ask = async (tool: keyof typeof tools, symbolId: string): Promise<Answer> => {
    // The full shape keeps the list fields these assertions read (`callers`, `references`, `impactedFiles`).
    const args = tool === 'impact_analysis' ? { symbolId, changeType: 'delete', format: 'full' } : { symbolId, format: 'full' };
    const result = (await tools[tool](args)) as { content: Array<{ text?: string }> };
    return JSON.parse(result.content[0].text ?? '{}') as Answer;
  };
  const idOf = (name: string): string => {
    const rows = store.getSymbolsByName(name);
    expect(rows.map((r) => r.name), name).toEqual([name]);
    return rows[0].id;
  };

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-tier-note-src-')));
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-tier-note-data-'));
    cacheRoot = mkdtempSync(join(tmpdir(), 'hesman-tier-note-cache-'));
    previousCacheDir = process.env.HESMAN_CACHE_DIR;
    process.env.HESMAN_CACHE_DIR = cacheRoot;
    copyFileSync(join(REPO, 'tests', 'fixtures', 'on-demand', 'r', 'stats.R'), join(root, 'stats.R'));
    writeFileSync(
      join(root, 'app.ts'),
      'export function helper(): number {\n  return 1;\n}\n\nexport function main(): number {\n  return helper();\n}\n\nexport function lonely(): number {\n  return 2;\n}\n',
    );
    writeFileSync(join(root, 'README.md'), '# Demo\n\nSome prose.\n');

    configureGrammarStore({ cacheRoot, offline: true });
    expect(grammarStore().installFromDirectory(join(REPO, 'tests', 'fixtures', 'grammars'), ['r'])).toEqual([
      { id: 'r', result: 'installed' },
    ]);
    store = new SqliteStore(dataDir);
    store.open();
    const run = await indexProject(root, store, { ...defaultConfig, projectRoot: root });
    expect(run.errors).toEqual([]);

    tools = {
      get_callers: captureTool((s) => registerGetCallersTool(s, store, { ...defaultConfig, projectRoot: root })),
      get_callees: captureTool((s) => registerGetCalleesTool(s, store, { ...defaultConfig, projectRoot: root })),
      get_references: captureTool((s) => registerGetReferencesTool(s, store, { ...defaultConfig, projectRoot: root })),
      impact_analysis: captureTool((s) => registerImpactAnalysisTool(s, store, { ...defaultConfig, projectRoot: root })),
    };
  });

  afterAll(() => {
    store.close();
    configureGrammarStore({ cacheRoot: undefined, fetch: undefined, offline: undefined });
    if (previousCacheDir === undefined) delete process.env.HESMAN_CACHE_DIR;
    else process.env.HESMAN_CACHE_DIR = previousCacheDir;
    for (const dir of [root, dataDir, cacheRoot]) rmSync(dir, { recursive: true, force: true });
  });

  describe('a symbol of a structural language (R, on demand)', () => {
    it('get_callers answers with an empty list and a note', async () => {
      const answer = await ask('get_callers', idOf('safe_mean'));
      expect(answer.callers).toEqual([]);
      expect(answer.note).toBe('call graph not available for r (symbols only)');
      expect(answer._meta).toBeDefined();
    });

    it('get_callees carries the same note', async () => {
      const answer = await ask('get_callees', idOf('report'));
      expect(answer.callees).toEqual([]);
      expect(answer.note).toBe('call graph not available for r (symbols only)');
    });

    it('impact_analysis carries the same note', async () => {
      const answer = await ask('impact_analysis', idOf('safe_mean'));
      expect(answer.impactedFiles).toEqual([]);
      expect(answer.note).toBe('call graph not available for r (symbols only)');
    });

    it('get_references says references are not available', async () => {
      const answer = await ask('get_references', idOf('safe_mean'));
      expect(answer.references).toEqual([]);
      expect(answer.note).toBe('references not available for r (symbols only)');
    });
  });

  describe('a symbol of a deep language (TypeScript)', () => {
    it.each(['get_callers', 'get_callees', 'get_references', 'impact_analysis'] as const)(
      '%s carries no note, with or without results',
      async (tool) => {
        expect(await ask(tool, idOf('helper'))).not.toHaveProperty('note');
        expect(await ask(tool, idOf('lonely'))).not.toHaveProperty('note');
      },
    );

    it('get_callers still finds the caller', async () => {
      expect((await ask('get_callers', idOf('helper'))).callers).toHaveLength(1);
    });
  });

  describe('the id of a text-tier chunk (Markdown)', () => {
    const chunk = (): string => textChunkId(join(root, 'README.md'), 0);

    it.each([
      ['get_callers', 'call graph not available for markdown (text only, no symbols)'],
      ['get_callees', 'call graph not available for markdown (text only, no symbols)'],
      ['get_references', 'references not available for markdown (text only, no symbols)'],
    ] as const)('%s carries a note', async (tool, note) => {
      expect((await ask(tool, chunk())).note).toBe(note);
    });

    it('impact_analysis explains why there is no symbol', async () => {
      const answer = await ask('impact_analysis', chunk());
      expect(answer.error?.code).toBe('SYMBOL_NOT_FOUND');
      expect(answer.error?.message).toContain('call graph not available for markdown (text only, no symbols)');
    });
  });

  it('an id that is neither a symbol nor a text chunk gets no note', async () => {
    expect(await ask('get_callers', 'ffffffffffffffff')).not.toHaveProperty('note');
    expect(await ask('get_references', 'ffffffffffffffff')).not.toHaveProperty('note');
    expect((await ask('impact_analysis', 'ffffffffffffffff')).error?.message).toBe('Symbol not found: ffffffffffffffff');
  });
});
