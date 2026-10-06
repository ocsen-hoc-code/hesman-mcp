import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, toolText, type HesmanTestServer } from './helpers/server.js';

interface FindPatternMatch {
  filePath: string;
  line: number;
  snippet: string;
  bindings: Record<string, string>;
}

interface FindPatternResponse {
  matches: FindPatternMatch[];
  totalFound: number;
  truncated?: boolean;
  truncatedReason?: string;
}

interface GetContextResponse {
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Builds a throwaway project:
 * - src/app.ts and lib/other.ts: plain code with a known `console.log` line.
 * - min/bundle.js: a single ~50KB line (minified-looking).
 * - min/dense.js: a line just under the length cap that makes `$$$A $$$B $$$C;`
 *   backtrack catastrophically.
 */
function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'hesman-find-pattern-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'lib'));
  mkdirSync(join(root, 'min'));

  writeFileSync(
    join(root, 'src', 'app.ts'),
    [
      'export function run(): void {',
      '  const value = 1;',
      "  console.log('app', value);",
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, 'lib', 'other.ts'), "export const other = (): void => console.log('other');\n");

  const longLine = 'var a=1,b=2;'.repeat(Math.ceil(50_000 / 12)).slice(0, 50_000).replace(/;$/, 'x');
  writeFileSync(join(root, 'min', 'bundle.js'), `${longLine}\n`);

  // ~3,900 chars of "a " with no ';' — every greedy split is tried before failing.
  const dense = 'a '.repeat(1950);
  writeFileSync(join(root, 'min', 'dense.js'), `const x = 1;\n// ${dense}\n`);

  return root;
}

describe('E2E find_pattern hardening', () => {
  let server: HesmanTestServer;
  let fixtureRoot: string;

  beforeAll(async () => {
    fixtureRoot = createFixture();
    server = await startServer({ fixture: fixtureRoot });
  }, 120000);

  afterAll(async () => {
    await server?.stop();
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('stays within its time budget on a pathological pattern and keeps the server responsive', async () => {
    const started = Date.now();
    const searchPromise = server.callTool(
      'find_pattern',
      { pattern: '$$$A $$$B $$$C;', language: 'typescript', filePattern: 'min/**' },
      20000,
    );

    // Give the server a moment to start the search, then probe responsiveness.
    await new Promise((r) => setTimeout(r, 300));
    const probeStarted = Date.now();
    await server.callTool('index_status', {}, 5000);
    const probeLatency = Date.now() - probeStarted;

    const result = await searchPromise;
    const elapsed = Date.now() - started;
    const data = JSON.parse(toolText(result)) as FindPatternResponse;

    expect(result.isError).toBeFalsy();
    expect(probeLatency).toBeLessThan(500);
    expect(elapsed).toBeLessThan(6000);
    expect(data.truncated).toBe(true);
    expect(typeof data.truncatedReason).toBe('string');
  }, 30000);

  it('matches filePattern against the project-relative path', async () => {
    const data = await server.callToolJson<FindPatternResponse>('find_pattern', {
      pattern: 'console.$METHOD($$$ARGS)',
      language: 'typescript',
      filePattern: 'src/**/*.ts',
    });
    expect(data.matches.length).toBe(1);
    expect(data.matches[0].filePath).toMatch(/src[\\/]app\.ts$/);
    expect(data.matches[0].bindings.METHOD).toBe('log');
  });

  it('returns 1-based line numbers that agree with get_context', async () => {
    const data = await server.callToolJson<FindPatternResponse>('find_pattern', {
      pattern: 'console.$METHOD($$$ARGS)',
      language: 'typescript',
      filePattern: 'src/**/*.ts',
    });
    const match = data.matches[0];
    expect(match.line).toBe(3);

    const ctx = await server.callToolJson<GetContextResponse>('get_context', {
      filePath: match.filePath,
      startLine: match.line,
      contextLines: 0,
      mode: 'full',
    });
    expect(ctx.content).toContain("console.log('app', value);");
  });

  it('rejects patterns over the documented limits', async () => {
    const cases: Array<[string, RegExp]> = [
      ['x'.repeat(501), /500/],
      ['$$$A $$$B $$$C $$$D', /\$\$\$/],
      ['$A $B $C $D $E $F $G $H $I', /8/],
    ];
    for (const [pattern, message] of cases) {
      const result = await server.callTool('find_pattern', { pattern, language: 'typescript' });
      expect(result.isError).toBe(true);
      const err = JSON.parse(toolText(result)) as { error: { code: string; message: string } } & Record<string, unknown>;
      expect(JSON.stringify(err)).toContain('INVALID_INPUT');
      expect(JSON.stringify(err)).toMatch(message);
    }
  });
});
