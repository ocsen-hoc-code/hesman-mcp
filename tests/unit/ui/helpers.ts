/**
 * Helpers for the `hesman ui` server tests: a temp project with a real index,
 * and a raw HTTP client that sends the path and headers exactly as given
 * (`fetch` would normalize `..` segments and refuse a custom `Host`).
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HesmanConfigSchema, type HesmanConfig } from '../../../src/config/schema';
import { indexProject } from '../../../src/indexing/index-coordinator';
import { SqliteStore } from '../../../src/stores/sqlite';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface TempProject {
  /** Temp directory holding everything below; removed by `cleanup`. */
  base: string;
  projectRoot: string;
  dataDir: string;
  /** A stand-in for `dist/ui/` with a few files. */
  staticDir: string;
  config: HesmanConfig;
  cleanup(): void;
}

/** A copy of the `polyglot-basic` fixture, indexed in-process, plus a static directory. */
export async function makeIndexedProject(): Promise<TempProject> {
  const base = mkdtempSync(join(tmpdir(), 'hesman-ui-'));
  const projectRoot = join(base, 'project');
  cpSync(join(REPO_ROOT, 'tests', 'fixtures', 'polyglot-basic'), projectRoot, { recursive: true });
  const dataDir = join(projectRoot, '.hesman');
  const config = HesmanConfigSchema.parse({});
  config.projectRoot = projectRoot;

  const store = new SqliteStore(dataDir);
  store.open();
  try {
    await indexProject(projectRoot, store, config);
  } finally {
    store.close();
  }

  const staticDir = join(base, 'static');
  mkdirSync(join(staticDir, 'assets'), { recursive: true });
  mkdirSync(join(staticDir, 'server'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Hesman test page</title>');
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("app");');
  writeFileSync(join(staticDir, 'assets', 'style.css'), 'body{}');
  writeFileSync(join(staticDir, 'server', 'server.js'), '// compiled server code');
  writeFileSync(join(staticDir, '.hidden'), 'hidden');
  writeFileSync(join(base, 'outside-secret.txt'), 'TOP-SECRET-OUTSIDE');

  return {
    base,
    projectRoot,
    dataDir,
    staticDir,
    config,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  /** The parsed body, or `undefined` when it is not JSON. */
  json: any;
}

export interface RawRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Sent as JSON with `Content-Type: application/json` unless `rawBody` is set. */
  body?: unknown;
  rawBody?: string;
}

/** One request to `127.0.0.1:<port>`; `path` goes on the wire untouched. */
export function rawRequest(port: number, path: string, options: RawRequestOptions = {}): Promise<RawResponse> {
  return new Promise((resolveResponse, reject) => {
    const headers: Record<string, string> = {};
    let payload: string | undefined;
    if (options.rawBody !== undefined) {
      payload = options.rawBody;
    } else if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    Object.assign(headers, options.headers);

    const req = request(
      { host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolveResponse({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
