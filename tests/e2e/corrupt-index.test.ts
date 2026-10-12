/**
 * Recovery from a corrupt index (M1-09), through the real binary. The index
 * is derived data: when SQLite reports `symbols.db` as corrupt, `hesman index`
 * and the MCP server move the damaged files aside and rebuild instead of
 * failing. Every corrupt database is created inside a temp directory.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { startServer, type HesmanTestServer } from './helpers/server';

const DIST_ENTRY = resolve(__dirname, '..', '..', 'dist', 'index.js');
const FIXTURE = resolve(__dirname, '..', 'fixtures', 'polyglot-basic');
const GARBAGE = 'this is not a database\n'.repeat(400);

let dirs: string[] = [];
let server: HesmanTestServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/** A copy of the polyglot fixture with its own `.hesman/` directory. */
function makeProject(): { root: string; dataDir: string; dbPath: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hesman-corrupt-')));
  dirs.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const dataDir = join(root, '.hesman');
  mkdirSync(dataDir, { recursive: true });
  return { root, dataDir, dbPath: join(dataDir, 'symbols.db') };
}

function runIndex(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [DIST_ENTRY, 'index', root, '--no-semantic'], {
    encoding: 'utf-8',
    cwd: root,
    env: { ...process.env, HESMAN_DATA_DIR: '', HESMAN_GRAMMARS_OFFLINE: '1', HESMAN_LOG_LEVEL: 'warn' },
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function symbolNames(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare('SELECT name FROM symbols ORDER BY name').all() as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
}

describe('finding 4: `hesman index` rebuilds a corrupt index', () => {
  it('a `symbols.db` that is not a database is moved aside and the index is rebuilt (exit 0)', () => {
    const { root, dataDir, dbPath } = makeProject();
    writeFileSync(dbPath, GARBAGE);

    const result = runIndex(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Done.');
    // The fixture defines these (go/greet.go, python/greet.py, ts/greet.ts).
    expect(symbolNames(dbPath)).toEqual(expect.arrayContaining(['GoGreet', 'py_greet', 'tsGreet']));
    // The damaged file is kept next to the new one, not deleted.
    expect(readFileSync(join(dataDir, 'symbols.db.corrupt'), 'utf-8')).toBe(GARBAGE);
    // One log line says what happened.
    const lines = result.stderr.split('\n').filter((line) => line.includes('corrupt'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('symbols.db.corrupt');
  });

  it('a damaged table found while an outdated index is cleared is rebuilt the same way (exit 0)', () => {
    const { root, dataDir, dbPath } = makeProject();
    expect(runIndex(root).status).toBe(0);
    const before = symbolNames(dbPath);
    expect(before.length).toBeGreaterThan(0);

    // An index of an older schema whose full-text table is damaged: clearing it
    // fails with SQLITE_CORRUPT_VTAB ("database disk image is malformed").
    const db = new Database(dbPath);
    db.unsafeMode(true); // shadow tables of a virtual table are write-protected otherwise
    db.exec("UPDATE symbols_fts_data SET block = x'00'");
    db.prepare("UPDATE metadata SET value = '1' WHERE key = 'index_schema_version'").run();
    db.close();

    const result = runIndex(root);
    expect(result.status, result.stderr).toBe(0);
    expect(symbolNames(dbPath)).toEqual(before);
    expect(existsSync(join(dataDir, 'symbols.db.corrupt'))).toBe(true);
    expect(result.stderr.split('\n').filter((line) => line.includes('corrupt'))).toHaveLength(1);
  });
});

describe('finding 4: the MCP server rebuilds a corrupt index at startup', () => {
  it('answers from a rebuilt index and keeps the damaged file', async () => {
    const { root, dataDir, dbPath } = makeProject();
    writeFileSync(dbPath, GARBAGE);

    server = await startServer({ fixture: root, tempDataDir: false });
    const status = await server.waitForIndex();
    expect(status.indexing?.error ?? null).toBeNull();
    expect(status.totalSymbols).toBeGreaterThan(0);
    const found = await server.callToolJson<{ symbols: Array<{ name: string }> }>('find_symbol', { name: 'GoGreet' });
    expect(found.symbols.map((s) => s.name)).toContain('GoGreet');
    expect(readFileSync(join(dataDir, 'symbols.db.corrupt'), 'utf-8')).toBe(GARBAGE);
    expect(server.nonProtocolStdoutLines).toEqual([]);
  });
});
