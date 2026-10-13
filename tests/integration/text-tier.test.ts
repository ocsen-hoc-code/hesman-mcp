/**
 * Text tier (M1-04): files without a grammar are indexed as line-range chunks.
 *
 * Works on a temp copy of `tests/fixtures/text-tier` so files can be edited.
 * The first block needs no embedding model (`--no-semantic` behaviour); the
 * second uses the real model and is skipped when it cannot be loaded.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer, ToolHandler } from '../../src/server/mcp-server.js';
import { SqliteStore } from '../../src/stores/sqlite.js';
import { ZVecStore } from '../../src/stores/zvec.js';
import { initEmbedding } from '../../src/stores/embedding.js';
import { indexProject, IndexAbortedError } from '../../src/indexing/index-coordinator.js';
import type { IndexProgress } from '../../src/indexing/index-state.js';
import { FileWatcher } from '../../src/indexing/file-watcher.js';
import { WorkerPool } from '../../src/indexing/worker-pool.js';
import { registerSemanticSearchTool } from '../../src/server/tools/semantic-search.js';
import { registerFindPatternTool } from '../../src/server/tools/find-pattern.js';
import { registerGetContextTool } from '../../src/server/tools/get-context.js';
import { registerFindSymbolTool } from '../../src/server/tools/find-symbol.js';
import { registerIndexStatusTool } from '../../src/server/tools/index-status.js';
import { textChunkId } from '../../src/parsers/text-chunker.js';
import { defaultConfig } from '../../src/config/defaults.js';
import type { HesmanConfig } from '../../src/config/schema.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'text-tier');

/** Text-tier files of the fixture (everything indexable except `src/app.ts`). */
const TEXT_FILES = ['Dockerfile', 'Makefile', 'build.zig', 'db/schema.sql', 'legacy/payroll.cobol', 'notes.xyzzy', 'scripts/deploy.zsh'];
const INDEXABLE_FILES = TEXT_FILES.length + 1;

type ToolResult = { content: Array<{ text?: string }>; isError?: boolean };

function captureTool(register: (server: McpServer) => void): ToolHandler {
  let captured: ToolHandler | undefined;
  const server = {
    registerTool(_name: string, _description: string, _schema: object, handler: ToolHandler) {
      captured = handler;
    },
  } as unknown as McpServer;
  register(server);
  if (!captured) throw new Error('tool was not registered');
  return captured;
}

async function call<T>(handler: ToolHandler, args: Record<string, unknown>): Promise<T> {
  const result = (await handler(args)) as ToolResult;
  expect(result.isError, result.content[0]?.text).toBeFalsy();
  return JSON.parse(result.content[0].text ?? '{}') as T;
}

interface Project {
  root: string;
  dataDir: string;
  config: HesmanConfig;
  store: SqliteStore;
  path(rel: string): string;
  dispose(): void;
}

function createProject(): Project {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-text-tier-src-')));
  const dataDir = mkdtempSync(join(tmpdir(), 'hesman-text-tier-data-'));
  cpSync(FIXTURE_DIR, root, { recursive: true });
  const store = new SqliteStore(dataDir);
  store.open();
  return {
    root,
    dataDir,
    config: { ...defaultConfig, projectRoot: root },
    store,
    path: (rel) => join(root, rel),
    dispose() {
      store.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

describe('text tier without semantic search', () => {
  let project: Project;
  let pool: WorkerPool | undefined;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(async () => {
    await pool?.terminate(true);
    pool = undefined;
    project.dispose();
  });

  for (const mode of ['single-threaded', 'worker pool'] as const) {
    it(`records text files and invents no symbols for them (${mode})`, async () => {
      if (mode === 'worker pool') pool = new WorkerPool(2);
      const result = await indexProject(project.root, project.store, project.config, undefined, pool);

      expect(result.errors).toEqual([]);
      expect(result.filesScanned).toBe(INDEXABLE_FILES);
      expect(result.filesIndexed).toBe(INDEXABLE_FILES);
      for (const rel of TEXT_FILES) {
        const record = project.store.getTextFile(project.path(rel));
        expect(record, rel).toBeDefined();
        expect(record!.chunk_count, rel).toBeGreaterThan(0);
        expect(project.store.getSymbolsByFile(project.path(rel)), rel).toEqual([]);
      }
      expect(project.store.getTextFile(project.path('db/schema.sql'))).toMatchObject({ language: 'sql', line_count: 16 });
      expect(project.store.getTextStats().files).toBe(TEXT_FILES.length);
      // Only the TypeScript file contributes symbols.
      expect(project.store.getLanguageStats().map((l) => l.language)).toEqual(['typescript']);
      expect(project.store.getTextFile(project.path('src/app.ts'))).toBeUndefined();
    });

    it(`reports text files through progress and skips them when unchanged (${mode})`, async () => {
      if (mode === 'worker pool') pool = new WorkerPool(2);
      const events: IndexProgress[] = [];
      await indexProject(project.root, project.store, project.config, undefined, pool, {
        onProgress: (p) => events.push({ ...p }),
      });
      expect(events[events.length - 1]).toEqual({ phase: 'resolving', filesDone: INDEXABLE_FILES, filesTotal: INDEXABLE_FILES });
      for (let i = 1; i < events.length; i++) {
        expect(events[i].filesDone).toBeGreaterThanOrEqual(events[i - 1].filesDone);
      }

      const again = await indexProject(project.root, project.store, project.config, undefined, pool);
      expect(again.filesIndexed).toBe(0);

      writeFileSync(project.path('Makefile'), 'all:\n\techo one\n\nclean:\n\trm -rf out\n\ntest:\n\tvitest\n');
      const changed = await indexProject(project.root, project.store, project.config, undefined, pool);
      expect(changed.filesIndexed).toBe(1);
      expect(project.store.getTextFile(project.path('Makefile'))).toMatchObject({ line_count: 8 });
    });
  }

  it('does not index the binary, the lockfile or the minified files', async () => {
    await indexProject(project.root, project.store, project.config);
    for (const rel of ['assets/firmware.blob', 'package-lock.json', 'vendor/theme.min.css', 'vendor/bundle.txt']) {
      expect(project.store.getTextFile(project.path(rel)), rel).toBeUndefined();
      expect(project.store.getFileHash(project.path(rel)), rel).toBeNull();
    }
  });

  it('honours an abort while text files are being indexed', async () => {
    const controller = new AbortController();
    const run = indexProject(project.root, project.store, project.config, undefined, undefined, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'indexing' && p.filesDone >= 2) controller.abort();
      },
    });
    await expect(run).rejects.toBeInstanceOf(IndexAbortedError);
    expect(project.store.getTextStats().files).toBeLessThan(TEXT_FILES.length);
  });

  it('drops the record of a deleted text file through the watcher', async () => {
    writeFileSync(project.path('notes.xyzzy'), 'plain notes\n');
    await indexProject(project.root, project.store, { ...project.config, languages: ['text'] });
    expect(project.store.getTextFile(project.path('notes.xyzzy'))).toBeDefined();
    const watcher = new FileWatcher({ projectRoot: project.root, ignore: [], store: project.store, pool: {} as WorkerPool });
    unlinkSync(project.path('notes.xyzzy'));
    (watcher as unknown as { handleDelete(p: string): void }).handleDelete(project.path('notes.xyzzy'));
    expect(project.store.getTextFile(project.path('notes.xyzzy'))).toBeUndefined();
    expect(project.store.getFileHash(project.path('notes.xyzzy'))).toBeNull();
  });

  it('re-chunks a text file changed while the watcher runs, and ignores files the scanner skips', async () => {
    await indexProject(project.root, project.store, project.config);
    const dispatch = async (): Promise<never[]> => {
      throw new Error('text files must not be sent to the parser pool');
    };
    const watcher = new FileWatcher({
      projectRoot: project.root,
      ignore: [],
      store: project.store,
      pool: { dispatch } as unknown as WorkerPool,
    });
    const handleChange = (p: string): Promise<void> =>
      (watcher as unknown as { handleChange(p: string): Promise<void> }).handleChange(p);

    writeFileSync(project.path('db/schema.sql'), 'CREATE TABLE refunds (id INTEGER PRIMARY KEY);\n');
    await handleChange(project.path('db/schema.sql'));
    expect(project.store.getTextFile(project.path('db/schema.sql'))).toMatchObject({ line_count: 1, chunk_count: 1 });

    writeFileSync(project.path('db/new.sql'), 'SELECT 1;\n');
    await handleChange(project.path('db/new.sql'));
    expect(project.store.getTextFile(project.path('db/new.sql'))).toMatchObject({ language: 'sql' });

    // Not text source: a binary, a lockfile, a file in an ignored directory.
    writeFileSync(project.path('assets/firmware.blob'), Buffer.from([1, 0, 2, 3]));
    writeFileSync(project.path('yarn.lock'), 'lock v1\n');
    writeFileSync(project.path('.env'), 'TOKEN=abc\n');
    for (const rel of ['assets/firmware.blob', 'yarn.lock', '.env']) {
      await handleChange(project.path(rel));
      expect(project.store.getTextFile(project.path(rel)), rel).toBeUndefined();
    }
  });

  it('find_pattern searches a text-tier language by its label and marks the result', async () => {
    const findPattern = captureTool((s) => registerFindPatternTool(s, project.config));
    const body = await call<{ matches: Array<{ filePath: string; line: number; bindings: Record<string, string> }>; precision?: string }>(
      findPattern,
      { pattern: 'CREATE TABLE $NAME (', language: 'sql' },
    );
    expect(body.matches.map((m) => [m.filePath, m.line, m.bindings.NAME])).toEqual([
      [project.path('db/schema.sql'), 2, 'customers'],
      [project.path('db/schema.sql'), 9, 'orders'],
    ]);
    expect(body.precision).toBe('text');

    const shell = await call<{ matches: Array<{ filePath: string }> }>(findPattern, { pattern: 'upload_release', language: 'shell' });
    expect(new Set(shell.matches.map((m) => m.filePath))).toEqual(new Set([project.path('scripts/deploy.zsh')]));

    const unknown = await call<{ matches: Array<{ filePath: string }> }>(findPattern, { pattern: 'Grue $WORD', language: 'text' });
    expect(unknown.matches.map((m) => m.filePath)).toEqual([project.path('notes.xyzzy')]);
  });

  it('find_pattern leaves results of a parsed language unmarked', async () => {
    const findPattern = captureTool((s) => registerFindPatternTool(s, project.config));
    const body = await call<{ matches: unknown[]; precision?: string }>(findPattern, { pattern: 'function $NAME(', language: 'typescript' });
    expect(body.matches).toHaveLength(1);
    expect(body.precision).toBeUndefined();
  });

  it('get_context returns the lines of a text-tier file with its label and precision', async () => {
    await indexProject(project.root, project.store, project.config);
    const getContext = captureTool((s) => registerGetContextTool(s, project.store, project.config));
    const body = await call<Record<string, unknown>>(getContext, {
      filePath: 'db/schema.sql',
      startLine: 9,
      endLine: 10,
      contextLines: 0,
      mode: 'full',
    });
    expect(body).toMatchObject({
      startLine: 9,
      endLine: 10,
      content: 'CREATE TABLE orders (\n  id INTEGER PRIMARY KEY,',
      language: 'sql',
      precision: 'text',
      totalLines: 16,
      symbolsInRange: [],
    });

    const parsed = await call<Record<string, unknown>>(getContext, { filePath: 'src/app.ts', startLine: 2 });
    expect(parsed.language).toBe('typescript');
    expect(parsed).not.toHaveProperty('precision');
  });

  it('find_symbol and index_status keep symbols and text files apart', async () => {
    await indexProject(project.root, project.store, project.config);
    const findSymbol = captureTool((s) => registerFindSymbolTool(s, project.store, project.config));
    for (const name of ['upload_release', 'customers', 'PAYROLL', 'build']) {
      const found = await call<{ symbols: unknown[] }>(findSymbol, { name, matchMode: 'fuzzy' });
      expect(found.symbols, name).toEqual([]);
    }
    const status = await call<{ totalFiles: number; textTier: { files: number; chunks: number; languages: Array<{ language: string }> } }>(
      captureTool((s) => registerIndexStatusTool(s, project.store)),
      {},
    );
    expect(status.totalFiles).toBe(1);
    expect(status.textTier.files).toBe(TEXT_FILES.length);
    expect(status.textTier.chunks).toBeGreaterThanOrEqual(TEXT_FILES.length);
    expect(status.textTier.languages.map((l) => l.language).sort()).toEqual(
      ['cobol', 'dockerfile', 'makefile', 'shell', 'sql', 'text', 'zig'],
    );
  });
});

let modelError: string | null = null;
try {
  await initEmbedding(defaultConfig.semanticSearch.embeddingModel);
} catch (err) {
  modelError = err instanceof Error ? err.message : String(err);
}
if (modelError) {
  console.warn(`[text-tier] semantic tests skipped: embedding model could not be loaded (${modelError})`);
}

interface SearchRow {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  language?: string;
  precision?: string;
}

describe.skipIf(modelError !== null)('text tier with semantic search', () => {
  let project: Project;
  let zvec: ZVecStore;
  let search: (args: Record<string, unknown>) => Promise<SearchRow[]>;

  beforeAll(async () => {
    project = createProject();
    zvec = new ZVecStore(project.dataDir);
    zvec.open();
    const result = await indexProject(project.root, project.store, project.config, zvec);
    expect(result.errors).toEqual([]);
    const handler = captureTool((s) => registerSemanticSearchTool(s, zvec, project.config));
    search = async (args) => (await call<{ results: SearchRow[] }>(handler, args)).results;
  }, 120_000);

  afterAll(() => {
    zvec?.close();
    project?.dispose();
  });

  it('returns a chunk of a file without a grammar, marked precision "text"', async () => {
    const rows = await search({ query: 'customers table with email and loyalty points', topK: 5 });
    const hit = rows.find((r) => r.filePath === project.path('db/schema.sql'));
    expect(hit).toBeDefined();
    expect(rows.indexOf(hit!)).toBeLessThan(3);
    expect(hit).toMatchObject({
      symbolId: textChunkId(project.path('db/schema.sql'), 0),
      kind: 'text',
      precision: 'text',
      language: 'sql',
      name: 'schema.sql',
      startLine: 1,
      endLine: 16,
    });
    const lines = readFileSync(project.path('db/schema.sql'), 'utf-8').split('\n');
    expect(hit!.snippet).toBe(lines.slice(hit!.startLine - 1, hit!.endLine).join('\n'));
  });

  it('leaves symbol results unmarked and ranks a matching symbol above text chunks', async () => {
    const rows = await search({ query: 'invoice total including tax', topK: 5 });
    expect(rows[0]).toMatchObject({ name: 'invoiceTotal', kind: 'function' });
    expect(rows[0]).not.toHaveProperty('precision');
    for (const row of rows) {
      expect(row.precision === 'text').toBe(row.kind === 'text');
    }
  });

  it('filters by kind "text" and by a text-tier language label', async () => {
    const textOnly = await search({ query: 'restart the web service after a deployment', kind: 'text', topK: 20 });
    expect(textOnly.length).toBeGreaterThan(0);
    expect(textOnly.every((r) => r.kind === 'text')).toBe(true);
    expect(textOnly[0].filePath).toBe(project.path('scripts/deploy.zsh'));

    const cobol = await search({ query: 'compute gross pay', language: 'cobol', topK: 20 });
    expect(cobol.map((r) => r.filePath)).toEqual([project.path('legacy/payroll.cobol')]);

    const functions = await search({ query: 'restart the web service after a deployment', kind: 'function', topK: 20 });
    expect(functions.every((r) => r.kind === 'function')).toBe(true);
  });

  it('never returns content of the binary, the lockfile or the minified files', async () => {
    const rows = await search({ query: 'upload_release', topK: 50 });
    const paths = new Set(rows.map((r) => r.filePath));
    for (const rel of ['assets/firmware.blob', 'package-lock.json', 'vendor/theme.min.css', 'vendor/bundle.txt']) {
      expect(paths.has(project.path(rel)), rel).toBe(false);
    }
  });

  it('keeps chunk ids stable across a re-index and replaces them when the file changes', async () => {
    const docsBefore = zvec.stats().docCount;
    const idsBefore = (await search({ query: 'docker image node install', kind: 'text', topK: 50 })).map((r) => r.symbolId).sort();

    const unchanged = await indexProject(project.root, project.store, project.config, zvec);
    expect(unchanged.filesIndexed).toBe(0);
    expect(zvec.stats().docCount).toBe(docsBefore);
    const idsAfter = (await search({ query: 'docker image node install', kind: 'text', topK: 50 })).map((r) => r.symbolId).sort();
    expect(idsAfter).toEqual(idsBefore);

    // Shrink a two-chunk file to one chunk: the second chunk must disappear.
    const big = Array.from({ length: 45 }, (_, i) => `quartz_marker_${i} = ${i}`).join('\n');
    writeFileSync(project.path('notes.xyzzy'), `${big}\n`);
    await indexProject(project.root, project.store, project.config, zvec);
    expect(project.store.getTextFile(project.path('notes.xyzzy'))).toMatchObject({ chunk_count: 2 });
    expect(zvec.stats().docCount).toBe(docsBefore + 1);

    writeFileSync(project.path('notes.xyzzy'), 'only one obsidian line now\n');
    await indexProject(project.root, project.store, project.config, zvec);
    expect(zvec.stats().docCount).toBe(docsBefore);
    const notes = (await search({ query: 'quartz marker obsidian', language: 'text', topK: 50 }));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ symbolId: textChunkId(project.path('notes.xyzzy'), 0), snippet: 'only one obsidian line now' });
  }, 60_000);

  it('removes the chunks of a deleted text file through the watcher', async () => {
    const docsBefore = zvec.stats().docCount;
    const chunkCount = project.store.getTextFile(project.path('build.zig'))!.chunk_count;
    const watcher = new FileWatcher({ projectRoot: project.root, ignore: [], store: project.store, pool: {} as WorkerPool, zvecStore: zvec });
    unlinkSync(project.path('build.zig'));
    (watcher as unknown as { handleDelete(p: string): void }).handleDelete(project.path('build.zig'));

    expect(zvec.stats().docCount).toBe(docsBefore - chunkCount);
    const rows = await search({ query: 'telemetry agent executable build', topK: 50 });
    expect(rows.some((r) => r.filePath === project.path('build.zig'))).toBe(false);
  });
});
