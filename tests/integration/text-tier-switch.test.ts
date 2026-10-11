/**
 * A file changes tier when the grammar for its language appears or disappears
 * (M1-05 delivers grammars on demand). Its content hash is unchanged, so the
 * coordinator must notice the tier change on its own and leave nothing of the
 * old tier behind.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** While true, Python has no grammar: `.py` files fall back to the text tier. */
const grammar = vi.hoisted(() => ({ pythonMissing: false }));
vi.mock('../../src/parsers/languages.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/parsers/languages.js')>();
  return {
    ...actual,
    languageForPath: (filePath: string): string | undefined => {
      const language = actual.languageForPath(filePath);
      return language === 'python' && grammar.pythonMissing ? undefined : language;
    },
  };
});

const { indexProject } = await import('../../src/indexing/index-coordinator.js');
const { SqliteStore } = await import('../../src/stores/sqlite.js');
const { defaultConfig } = await import('../../src/config/defaults.js');

describe('a file moving between the parsed tier and the text tier', () => {
  let root: string;
  let dataDir: string;
  let store: InstanceType<typeof SqliteStore>;
  let file: string;

  beforeEach(() => {
    grammar.pythonMissing = false;
    root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-tier-switch-src-')));
    dataDir = mkdtempSync(join(tmpdir(), 'hesman-tier-switch-data-'));
    file = join(root, 'billing.py');
    writeFileSync(file, 'def charge(amount):\n    return amount * 2\n\n\ndef refund(amount):\n    return charge(-amount)\n');
    store = new SqliteStore(dataDir);
    store.open();
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('falls back to text when the grammar disappears, and is parsed again when it returns', async () => {
    const config = { ...defaultConfig, projectRoot: root };

    await indexProject(root, store, config);
    expect(store.getSymbolsByFile(file).map((s) => s.name).sort()).toEqual(['charge', 'refund']);
    expect(store.getTextFile(file)).toBeUndefined();
    expect(store.getTotalRelations()).toBeGreaterThan(0);

    grammar.pythonMissing = true;
    const asText = await indexProject(root, store, config);
    expect(asText.errors).toEqual([]);
    expect(asText.filesIndexed).toBe(1);
    expect(store.getSymbolsByFile(file)).toEqual([]);
    expect(store.getTotalRelations()).toBe(0);
    expect(store.getTextFile(file)).toMatchObject({ language: 'python', line_count: 6, chunk_count: 1 });

    grammar.pythonMissing = false;
    const parsedAgain = await indexProject(root, store, config);
    expect(parsedAgain.filesIndexed).toBe(1);
    expect(store.getSymbolsByFile(file).map((s) => s.name).sort()).toEqual(['charge', 'refund']);
    expect(store.getTextFile(file)).toBeUndefined();

    const settled = await indexProject(root, store, config);
    expect(settled.filesIndexed).toBe(0);
  });
});
