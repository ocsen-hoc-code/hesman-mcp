import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_SCHEMA_VERSION, SqliteStore } from '../../stores/sqlite.js';

/**
 * Read-only access to a project's symbol index for `hesman ui`.
 *
 * The dashboard runs next to the MCP server that owns the index, so it must
 * never write: `SqliteStore.open()` creates the directory, switches the
 * journal mode and runs migrations, all of which are writes. This module opens
 * the database file itself with `readonly: true` (SQLite then refuses every
 * write on this connection) and hands the tools a `SqliteStore` that uses that
 * connection. WAL mode lets this reader and the server's writer work at the
 * same time; each query sees the last committed state.
 */

/** Thrown when the index cannot be served; the message is meant for the terminal. */
export class IndexUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexUnavailableError';
  }
}

/**
 * A `SqliteStore` over an already open read-only connection. `db` is a private
 * field of `SqliteStore`; it is assigned here because `stores/sqlite.ts`
 * offers no read-only open and every read method only needs that field.
 */
class ReadOnlySqliteStore extends SqliteStore {
  constructor(dataDir: string, db: BetterSqlite3.Database) {
    super(dataDir);
    (this as unknown as { db: BetterSqlite3.Database }).db = db;
  }

  /** The connection is already open; the inherited `open()` would write. */
  override open(): void {}
}

export interface ReadOnlyIndex {
  /** For the tool handlers. Every write method fails with SQLITE_READONLY. */
  store: SqliteStore;
  /** For the graph queries of the dashboard (`graph.ts`). */
  db: BetterSqlite3.Database;
  close(): void;
}

/**
 * Opens `<dataDir>/symbols.db` read-only.
 * @throws IndexUnavailableError when there is no index, or it was written by another Hesman version.
 */
export function openReadOnlyIndex(dataDir: string): ReadOnlyIndex {
  const dbPath = join(dataDir, 'symbols.db');
  const how = 'Run `hesman index` in the project (or start the MCP server once) to create it.';
  if (!existsSync(dbPath)) {
    throw new IndexUnavailableError(`No index found at ${dbPath}. ${how}`);
  }

  let db: BetterSqlite3.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw new IndexUnavailableError(`The index at ${dbPath} cannot be opened: ${(err as Error).message}`);
  }

  try {
    db.pragma('query_only = ON');
    const row = db.prepare("SELECT value FROM metadata WHERE key = 'index_schema_version'").get() as
      | { value: string }
      | undefined;
    const version = row ? Number(row.value) : 0;
    if (version !== INDEX_SCHEMA_VERSION) {
      throw new IndexUnavailableError(
        `The index at ${dbPath} has schema version ${version}, this Hesman reads version ${INDEX_SCHEMA_VERSION}. ` +
          'Run `hesman index` in the project (or restart the MCP server) to rebuild it.',
      );
    }
  } catch (err) {
    db.close();
    if (err instanceof IndexUnavailableError) throw err;
    throw new IndexUnavailableError(`The index at ${dbPath} is not readable: ${(err as Error).message}. ${how}`);
  }

  const store = new ReadOnlySqliteStore(dataDir, db);
  return { store, db, close: () => db.close() };
}
