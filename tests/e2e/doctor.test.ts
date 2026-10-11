/**
 * `hesman doctor` against real processes: the probe that starts a server command, and one run of
 * the whole doctor code path against THIS build (`node dist/index.js`). Offline: no entry uses
 * `npx`, so the registry is never asked. The client configs live in a temp home.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getClient } from '../../src/cli/clients/index';
import { launchFor } from '../../src/cli/clients/entry';
import type { ClientEnvironment } from '../../src/cli/clients/types';
import { runDoctor } from '../../src/cli/doctor/doctor';
import { realDoctorEnvironment } from '../../src/cli/doctor/environment';
import type { DoctorReport } from '../../src/cli/doctor/types';
import { DIST_ENTRY, REPO_ROOT } from './helpers/server';

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory the server recognises as a project (it holds a manifest). */
function tempProject(): string {
  const dir = tempDir('hesman-doctor-project-');
  writeFileSync(join(dir, 'package.json'), '{ "name": "doctor-fixture" }\n');
  writeFileSync(join(dir, 'index.ts'), 'export const answer = 42;\n');
  return dir;
}

/** A stand-in "server" script; a file, because the probe appends flags that `node -e` would take as its own. */
function fakeServer(source: string): string {
  const file = join(tempDir('hesman-doctor-script-'), 'server.cjs');
  writeFileSync(file, source);
  return file;
}

const machine = realDoctorEnvironment();
const node = process.execPath;

describe('doctor probe (real processes)', () => {
  it('completes the handshake with this build, sees clean stdout and the project found from the working directory', async () => {
    const project = tempProject();

    const result = await machine.probe({ command: node, args: [DIST_ENTRY], cwd: project, timeoutMs: 20_000 });

    expect(result.spawnError).toBeUndefined();
    expect(result.timedOut).toBe(false);
    expect(result.handshakeMs).toBeGreaterThan(0);
    expect(result.server?.name).toBe('hesman');
    expect(result.nonProtocolStdout).toEqual([]);
    expect(result.project).toEqual({ state: 'opened', root: project, source: 'working directory' });
    // The probe must not leave an index (or anything else) in the project.
    expect(readdirSync(project).sort()).toEqual(['index.ts', 'package.json']);
  }, 40_000);

  it('reports NO_PROJECT from a directory that is not a project', async () => {
    const empty = tempDir('hesman-doctor-empty-');

    const result = await machine.probe({ command: node, args: [DIST_ENTRY], cwd: empty, timeoutMs: 20_000 });

    expect(result.handshakeMs).toBeGreaterThan(0);
    expect(result.project).toEqual({ state: 'none' });
    expect(readdirSync(empty)).toEqual([]);
  }, 40_000);

  it('reports the explicit root of an entry that pins one', async () => {
    const project = tempProject();
    const elsewhere = tempDir('hesman-doctor-empty-');

    const result = await machine.probe({ command: node, args: [DIST_ENTRY, '--project-root', project], cwd: elsewhere, timeoutMs: 20_000 });

    expect(result.project).toEqual({ state: 'opened', root: project, source: 'explicit' });
    expect(existsSync(join(project, '.hesman'))).toBe(false);
  }, 40_000);

  it('records stdout pollution and a start that is too slow', async () => {
    const script = fakeServer('console.log("starting up..."); setTimeout(() => {}, 60000);');

    const result = await machine.probe({ command: node, args: [script], cwd: tempDir('hesman-doctor-empty-'), timeoutMs: 400 });

    expect(result.timedOut).toBe(true);
    expect(result.handshakeMs).toBeUndefined();
    expect(result.nonProtocolStdout).toEqual(['starting up...']);
    expect(result.project.state).toBe('unknown');
  }, 20_000);

  it('records a crash on start with its exit code and stderr', async () => {
    const script = fakeServer('console.error("Error: cannot find the index"); process.exit(3);');

    const result = await machine.probe({ command: node, args: [script], cwd: tempDir('hesman-doctor-empty-'), timeoutMs: 10_000 });

    expect(result.exit).toEqual({ code: 3, signal: null });
    expect(result.timedOut).toBe(false);
    expect(result.handshakeMs).toBeUndefined();
    expect(result.stderrTail.join('\n')).toContain('cannot find the index');
  }, 20_000);

  it('records a command that cannot be spawned', async () => {
    const result = await machine.probe({ command: join(tempDir('hesman-doctor-empty-'), 'no-such-binary'), args: [], cwd: tmpdir(), timeoutMs: 5000 });

    expect(result.spawnError).toMatch(/ENOENT/);
    expect(result.handshakeMs).toBeUndefined();
  }, 20_000);
});

describe('hesman doctor (this build, temp home)', () => {
  it('passes every check for a client configured by setup and writes nothing', async () => {
    const home = tempDir('hesman-doctor-home-');
    const project = tempProject();
    const env: ClientEnvironment = {
      home,
      cwd: project,
      platform: process.platform,
      env: {},
      installation: { execPath: node, entryScript: DIST_ENTRY, version: '0.0.0-test' },
      findOnPath: () => undefined,
      realpath: (path) => path,
      run: () => {
        throw new Error('doctor must not run client CLIs');
      },
    };
    const client = getClient('gemini-cli', env);
    client.write(launchFor(client, 'auto', env).entry);
    const configBefore = readdirSync(home, { recursive: true }).sort();
    const lines: string[] = [];

    const code = await runDoctor(['--json', '--timeout', '20000'], { env, out: (line) => lines.push(line) }, machine);

    const report = JSON.parse(lines.join('\n')) as DoctorReport;
    expect(report.server.checks.map((c) => [c.id, c.status])).toEqual([
      ['entry-script', 'pass'],
      ['node', 'pass'],
      ['parsers', 'pass'],
    ]);
    expect(report.clients.map((c) => c.id)).toEqual(['gemini-cli']);
    expect(report.clients[0].checks.map((c) => [c.id, c.status])).toEqual([
      ['config', 'pass'],
      ['entry', 'pass'],
      ['command', 'pass'],
      ['handshake', 'pass'],
      ['stdout', 'pass'],
      ['project', 'pass'],
    ]);
    expect(report.clients[0].checks[5].details).toMatchObject({ source: 'working directory', root: project });
    expect(code).toBe(0);
    expect(readdirSync(home, { recursive: true }).sort()).toEqual(configBefore);
    expect(readdirSync(project).sort()).toEqual(['index.ts', 'package.json']);
  }, 40_000);

  it('is reachable as a subcommand of the binary and listed in --help', () => {
    const usage = spawnSync(node, [DIST_ENTRY, 'doctor', '--client', 'nope'], { encoding: 'utf-8', cwd: REPO_ROOT });
    expect(usage.status).toBe(1);
    expect(usage.stdout).toContain('Unknown client "nope"');

    const help = spawnSync(node, [DIST_ENTRY, '--help'], { encoding: 'utf-8', cwd: REPO_ROOT });
    expect(help.stdout).toMatch(/hesman doctor/);
  }, 20_000);
});
