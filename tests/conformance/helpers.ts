/**
 * Shared pieces of the language conformance suite (M1-03).
 *
 * The suite is driven by data: every entry of `LANGUAGES` must have a fixture
 * directory `tests/fixtures/languages/<id>/` holding source files and an
 * `expected.json`. Nothing in here names a language, so a new registry entry is
 * covered as soon as its fixtures exist, and fails loudly until they do.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, type Node } from 'web-tree-sitter';
import { LANGUAGES, QUERIES_DIR, languageForPath, tagsQueryFiles } from '../../src/parsers/languages';
import type { LanguageDefinition } from '../../src/parsers/languages';
import { TagsQuery } from '../../src/parsers/tags-engine';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
/** One directory per registered language id. */
export const FIXTURES_ROOT = join(REPO, 'tests', 'fixtures', 'languages');
export const EXPECTED_FILE = 'expected.json';
/** ERROR/MISSING nodes a fixture may contain unless its `expected.json` says otherwise. */
export const DEFAULT_MAX_ERROR_NODES = 0;
/** Tiers whose languages must yield call relations. */
export const TIERS_WITH_CALLS: ReadonlySet<string> = new Set(['deep']);
/** Every tier a registry entry may declare. */
export const KNOWN_TIERS: ReadonlySet<string> = new Set(['deep', 'structural']);
const CONTRIBUTING = 'docs/CONTRIBUTING.md, "Adding a Language"';

// ---------------------------------------------------------------------------
// expected.json
// ---------------------------------------------------------------------------

/** A definition the extractor MUST find in a fixture file. */
export interface ExpectedSymbol {
  name: string;
  /** Hesman kind (`function`, `class`, `method`, ...). */
  kind: string;
  /** 1-based line the definition starts on. */
  line: number;
  isExported: boolean;
  /** Text the stored doc comment must contain. Omit when the definition has no doc comment. */
  doc?: string;
}

/** A call the relation pipeline MUST report: `from` (enclosing symbol) calls `to` (callee name). */
export interface ExpectedCall {
  from: string;
  to: string;
}

export interface ExpectedFile {
  /** Allowed ERROR + MISSING nodes; defaults to `DEFAULT_MAX_ERROR_NODES`. */
  maxErrorNodes?: number;
  /** Sanity bounds on the number of symbols extracted from the file. */
  symbolCount: { min: number; max: number };
  symbols: ExpectedSymbol[];
  /** Required for at least one file of a language whose tier has a call graph. */
  calls?: ExpectedCall[];
}

export type GapCheck = 'parse' | 'symbols' | 'docs' | 'calls';

/**
 * An expectation that is known not to hold yet. The expectation stays in
 * `expected.json` with its correct value; the gap documents why it fails
 * today. The suite fails when a listed gap starts to pass, so the entry is
 * removed in the change that fixes it.
 */
export interface KnownGap {
  file: string;
  check: GapCheck;
  /** `name@line` of a symbol (`symbols`, `docs`), `from->to` of a call (`calls`); absent for `parse`. */
  subject?: string;
  reason: string;
  /** The task expected to close the gap, e.g. `M1-05`. */
  fixedBy: string;
}

export interface Expected {
  files: Record<string, ExpectedFile>;
  knownGaps?: KnownGap[];
}

export interface FixtureSet {
  def: LanguageDefinition;
  dir: string;
  expected: Expected;
  /** Fixture file names, sorted. */
  files: string[];
}

export const symbolSubject = (s: Pick<ExpectedSymbol, 'name' | 'line'>): string => `${s.name}@${s.line}`;
export const callSubject = (c: ExpectedCall): string => `${c.from}->${c.to}`;

/** `tests/fixtures/languages/<id>` as a repository-relative path, for messages. */
function fixtureDirLabel(id: string): string {
  return `tests/fixtures/languages/${id}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Loads and validates the fixtures of one registered language.
 * Throws an `Error` whose message names the language and says exactly what a
 * contributor has to add or fix.
 */
export function loadFixtureSet(def: LanguageDefinition): FixtureSet {
  const label = fixtureDirLabel(def.id);
  const dir = join(FIXTURES_ROOT, def.id);
  const extensions = def.extensions.join(', ');

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(
      `[${def.id}] is registered in src/parsers/languages.ts but has no fixture directory. ` +
        `Add ${label}/ with at least one small, realistic source file (${extensions}) and ` +
        `${label}/${EXPECTED_FILE} listing the definitions that must be found (see ${CONTRIBUTING}).`,
    );
  }

  const sources = readdirSync(dir)
    .filter((name) => name !== EXPECTED_FILE && !name.startsWith('.') && statSync(join(dir, name)).isFile())
    .sort();
  if (sources.length === 0) {
    throw new Error(
      `[${def.id}] ${label}/ has no source file. Add at least one small, realistic file (${extensions}) ` +
        `and describe it in ${label}/${EXPECTED_FILE} (see ${CONTRIBUTING}).`,
    );
  }

  const expectedPath = join(dir, EXPECTED_FILE);
  if (!existsSync(expectedPath)) {
    throw new Error(
      `[${def.id}] ${label}/${EXPECTED_FILE} is missing. Add it with one entry per fixture file ` +
        `(${sources.join(', ')}): { "files": { "<file>": { "symbolCount": { "min": n, "max": n }, ` +
        `"symbols": [{ "name", "kind", "line", "isExported", "doc"? }], "calls": [{ "from", "to" }] } } } ` +
        `(see ${CONTRIBUTING}).`,
    );
  }

  let expected: Expected;
  try {
    expected = JSON.parse(readFileSync(expectedPath, 'utf-8')) as Expected;
  } catch (err) {
    throw new Error(`[${def.id}] ${label}/${EXPECTED_FILE} is not valid JSON: ${(err as Error).message}`);
  }

  const problems: string[] = [];
  if (!isObject(expected) || !isObject(expected.files)) {
    throw new Error(`[${def.id}] ${label}/${EXPECTED_FILE} must be an object with a "files" object.`);
  }

  for (const file of sources) {
    if (!(file in expected.files)) {
      problems.push(`fixture file ${file} has no entry under "files"`);
    }
    if (languageForPath(file) !== def.id) {
      problems.push(
        `fixture file ${file} is not a ${def.id} file (extensions: ${extensions}); move it to the directory of its language`,
      );
    }
  }

  let calls = 0;
  const subjects = new Map<string, Set<string>>();
  for (const [file, entry] of Object.entries(expected.files)) {
    if (!sources.includes(file)) {
      problems.push(`"files" lists ${file}, which does not exist in ${label}/`);
      continue;
    }
    const known = new Set<string>();
    subjects.set(file, known);
    if (!isObject(entry) || !Array.isArray(entry.symbols) || entry.symbols.length === 0) {
      problems.push(`${file}: "symbols" must list at least one definition`);
      continue;
    }
    const count = entry.symbolCount;
    if (!isObject(count) || !Number.isInteger(count.min) || !Number.isInteger(count.max) || count.min < 1 || count.max < count.min) {
      problems.push(`${file}: "symbolCount" must be { "min": n, "max": m } with 1 <= n <= m`);
    }
    if (entry.maxErrorNodes !== undefined && (!Number.isInteger(entry.maxErrorNodes) || entry.maxErrorNodes < 0)) {
      problems.push(`${file}: "maxErrorNodes" must be a non-negative integer`);
    }
    for (const symbol of entry.symbols) {
      if (
        !isObject(symbol) ||
        typeof symbol.name !== 'string' ||
        typeof symbol.kind !== 'string' ||
        !Number.isInteger(symbol.line) ||
        typeof symbol.isExported !== 'boolean' ||
        (symbol.doc !== undefined && (typeof symbol.doc !== 'string' || symbol.doc.length === 0))
      ) {
        problems.push(
          `${file}: every symbol needs "name" (string), "kind" (string), "line" (integer), "isExported" (boolean) ` +
            `and an optional non-empty "doc": ${JSON.stringify(symbol)}`,
        );
        continue;
      }
      known.add(symbolSubject(symbol));
    }
    for (const call of entry.calls ?? []) {
      if (!isObject(call) || typeof call.from !== 'string' || typeof call.to !== 'string') {
        problems.push(`${file}: every call needs "from" and "to" (strings): ${JSON.stringify(call)}`);
        continue;
      }
      known.add(callSubject(call));
      calls++;
    }
  }

  for (const gap of expected.knownGaps ?? []) {
    const where = `knownGaps entry ${JSON.stringify(gap)}`;
    if (!isObject(gap) || typeof gap.reason !== 'string' || !gap.reason || typeof gap.fixedBy !== 'string' || !gap.fixedBy) {
      problems.push(`${where}: needs a non-empty "reason" and "fixedBy"`);
      continue;
    }
    if (!['parse', 'symbols', 'docs', 'calls'].includes(gap.check)) {
      problems.push(`${where}: "check" must be parse, symbols, docs or calls`);
    } else if (!subjects.has(gap.file)) {
      problems.push(`${where}: "file" is not a fixture file listed under "files"`);
    } else if (gap.check !== 'parse' && !subjects.get(gap.file)!.has(gap.subject ?? '')) {
      problems.push(`${where}: "subject" must be the name@line of a listed symbol or the from->to of a listed call`);
    }
  }

  if (TIERS_WITH_CALLS.has(def.tier) && calls === 0) {
    problems.push(
      `tier "${def.tier}" promises a call graph, but no fixture file lists "calls"; add a call between two functions ` +
        `to a fixture and record it as { "from": "<caller>", "to": "<callee>" }`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`[${def.id}] ${label}/${EXPECTED_FILE} is incomplete:\n  - ${problems.join('\n  - ')}\n(see ${CONTRIBUTING})`);
  }
  return { def, dir, expected, files: sources };
}

/** Fixture directories that belong to no registered language (a typo, or a language that was removed). */
export function unregisteredFixtureDirs(): string[] {
  if (!existsSync(FIXTURES_ROOT)) return [];
  const ids = new Set(LANGUAGES.map((l) => l.id));
  return readdirSync(FIXTURES_ROOT)
    .filter((name) => statSync(join(FIXTURES_ROOT, name)).isDirectory() && !ids.has(name))
    .sort();
}

/** The known gap for one expectation, if any. */
export function gapFor(set: FixtureSet, file: string, check: GapCheck, subject?: string): KnownGap | undefined {
  return (set.expected.knownGaps ?? []).find(
    (gap) => gap.file === file && gap.check === check && (check === 'parse' || gap.subject === subject),
  );
}

// ---------------------------------------------------------------------------
// Grammar and queries
// ---------------------------------------------------------------------------

/** Loads the committed grammar of a language; the error names the language and the file. */
export async function loadGrammar(def: LanguageDefinition): Promise<Language> {
  try {
    return await Language.load(def.profile.parserWasmPath);
  } catch (err) {
    throw new Error(`[${def.id}] grammar parsers/${def.grammar} does not load: ${(err as Error).message}`);
  }
}

/** A tags query layer of a language, named by its path relative to `queries/`. */
export function queryLayersOf(def: LanguageDefinition): Array<{ name: string; file: string }> {
  return tagsQueryFiles(def).map((file) => ({ name: relative(QUERIES_DIR, file).split(sep).join('/'), file }));
}

/**
 * Compiles the given tags query layers of a language against `language`.
 * Throws with the language id and the query file when one does not fit the grammar.
 */
export function compileTagsQueries(
  def: LanguageDefinition,
  language: Language,
  layers: Array<{ name: string; file: string }> = queryLayersOf(def),
): void {
  let query: TagsQuery;
  try {
    query = new TagsQuery(
      language,
      layers.map((layer) => ({ name: `queries/${layer.name}`, source: readFileSync(layer.file, 'utf-8') })),
    );
  } catch (err) {
    throw new Error(`[${def.id}] ${(err as Error).message} (grammar: parsers/${def.grammar})`);
  }
  query.delete();
}

/** Number of ERROR and MISSING nodes under `root`, with the first few locations for messages. */
export function countErrorNodes(root: Node): { count: number; samples: string[] } {
  let count = 0;
  const samples: string[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'ERROR' || node.isMissing) {
      count++;
      if (samples.length < 3) {
        const what = node.isMissing ? `MISSING ${node.type}` : 'ERROR';
        samples.push(`${what} at line ${node.startPosition.row + 1}`);
      }
    }
    // An error-free subtree cannot contain either kind.
    if (!node.hasError) continue;
    for (const child of node.children) {
      if (child) stack.push(child);
    }
  }
  return { count, samples };
}

// ---------------------------------------------------------------------------
// Assertions shared by the in-process suite and the worker-pool slice
// ---------------------------------------------------------------------------

/** The columns of a symbol the suite looks at (an `ExtractedSymbol` or a stored `SymbolRow`). */
export interface ActualSymbol {
  id: string;
  name: string;
  kind: string;
  start_line: number;
  is_exported: number;
  signature: string | null;
  doc_comment: string | null;
}

const describeSymbol = (s: ExpectedSymbol): string =>
  `${s.isExported ? 'exported' : 'non-exported'} ${s.kind} "${s.name}" at line ${s.line}`;

/** Throws unless `expected` was extracted with the same name, line, kind and export flag. */
export function assertSymbolExtracted(
  language: string,
  file: string,
  expected: ExpectedSymbol,
  actual: readonly ActualSymbol[],
): ActualSymbol {
  const found = actual.find((s) => s.name === expected.name && s.start_line === expected.line);
  if (!found) {
    const sameName = actual.filter((s) => s.name === expected.name).map((s) => `${s.kind} at line ${s.start_line}`);
    throw new Error(
      `[${language}] ${file}: expected ${describeSymbol(expected)} was not extracted` +
        (sameName.length > 0 ? ` (found "${expected.name}" as: ${sameName.join(', ')})` : ` (no symbol named "${expected.name}")`),
    );
  }
  if (found.kind !== expected.kind) {
    throw new Error(`[${language}] ${file}: expected ${describeSymbol(expected)}, but its kind is "${found.kind}"`);
  }
  if ((found.is_exported === 1) !== expected.isExported) {
    throw new Error(
      `[${language}] ${file}: expected ${describeSymbol(expected)}, but it is ${found.is_exported === 1 ? 'exported' : 'not exported'}`,
    );
  }
  return found;
}

/** Throws unless the symbol has a signature and, when the fixture documents it, the doc comment. */
export function assertSymbolDocumented(
  language: string,
  file: string,
  expected: ExpectedSymbol,
  actual: readonly ActualSymbol[],
): void {
  const found = actual.find((s) => s.name === expected.name && s.start_line === expected.line);
  if (!found) throw new Error(`[${language}] ${file}: "${expected.name}" at line ${expected.line} was not extracted`);
  if (!found.signature || found.signature.trim().length === 0) {
    throw new Error(`[${language}] ${file}: "${expected.name}" at line ${expected.line} has an empty signature`);
  }
  if (expected.doc !== undefined && !(found.doc_comment ?? '').includes(expected.doc)) {
    throw new Error(
      `[${language}] ${file}: doc comment of "${expected.name}" at line ${expected.line} should contain ` +
        `${JSON.stringify(expected.doc)}, got ${JSON.stringify(found.doc_comment)}`,
    );
  }
}

/** Runs `assert` for every item and throws one error listing all failures (not only the first). */
export function assertAll<T>(items: readonly T[], assert: (item: T) => void): void {
  const failures: string[] = [];
  for (const item of items) {
    try {
      assert(item);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}

// ---------------------------------------------------------------------------
// Per-language report
// ---------------------------------------------------------------------------

export type Outcome = 'pass' | 'fail' | 'gap' | 'stale-gap';

interface Entry {
  language: string;
  check: string;
  outcome: Outcome;
  detail: string;
}

/**
 * Collects the outcome of every check and renders one row per language, so a
 * regression shows up as `FAIL` in the cell of the language and check it broke.
 */
export class ConformanceReport {
  private readonly entries: Entry[] = [];

  constructor(
    private readonly title: string,
    private readonly columns: readonly string[],
  ) {}

  record(language: string, check: string, outcome: Outcome, detail = ''): void {
    this.entries.push({ language, check, outcome, detail });
  }

  /**
   * Wraps a test body: the outcome is recorded under `language` / `check`, and
   * a failure is rethrown so the test itself still fails.
   */
  check(language: string, check: string, body: () => void | Promise<void>): () => Promise<void> {
    return async () => {
      try {
        await body();
      } catch (err) {
        this.record(language, check, 'fail', firstLine(err));
        throw err;
      }
      this.record(language, check, 'pass');
    };
  }

  /**
   * Wraps the test body of a known gap: the body is expected to throw. When it
   * does not, the gap is stale and the test fails, telling the contributor to
   * remove the entry.
   */
  knownGap(language: string, check: string, gap: KnownGap, body: () => void | Promise<void>): () => Promise<void> {
    return async () => {
      try {
        await body();
      } catch (err) {
        this.record(language, check, 'gap', `${describeGap(gap)} — ${firstLine(err)}`);
        return;
      }
      this.record(language, check, 'stale-gap', describeGap(gap));
      throw new Error(
        `[${language}] known gap no longer fails: ${describeGap(gap)}. ` +
          `Remove it from "knownGaps" in ${fixtureDirLabel(language)}/${EXPECTED_FILE} (it was waiting for ${gap.fixedBy}).`,
      );
    };
  }

  private cell(language: string, check: string): string {
    const own = this.entries.filter((e) => e.language === language && e.check === check);
    if (own.length === 0) return '-';
    if (own.some((e) => e.outcome === 'fail' || e.outcome === 'stale-gap')) return 'FAIL';
    const gaps = own.filter((e) => e.outcome === 'gap').length;
    if (gaps === 0) return 'pass';
    const passed = own.length - gaps;
    return `${passed > 0 ? 'pass' : 'gap'} (${gaps} known ${gaps === 1 ? 'gap' : 'gaps'})`;
  }

  /** True if nothing failed. */
  get ok(): boolean {
    return !this.entries.some((e) => e.outcome === 'fail' || e.outcome === 'stale-gap');
  }

  toJSON(languages: readonly LanguageDefinition[]): unknown {
    return {
      title: this.title,
      ok: this.ok,
      languages: languages.map((def) => ({
        id: def.id,
        tier: def.tier ?? null,
        checks: Object.fromEntries(this.columns.map((column) => [column, this.cell(def.id, column)])),
        failures: this.entries
          .filter((e) => e.language === def.id && (e.outcome === 'fail' || e.outcome === 'stale-gap'))
          .map((e) => ({ check: e.check, detail: e.detail })),
        knownGaps: this.entries
          .filter((e) => e.language === def.id && e.outcome === 'gap')
          .map((e) => ({ check: e.check, detail: e.detail })),
      })),
    };
  }

  /** A Markdown table (one row per language) followed by the failures and the known gaps. */
  render(languages: readonly LanguageDefinition[]): string {
    const header = ['language', 'tier', ...this.columns, 'result'];
    const rows = languages.map((def) => {
      const cells = this.columns.map((column) => this.cell(def.id, column));
      const failed = this.entries.some((e) => e.language === def.id && (e.outcome === 'fail' || e.outcome === 'stale-gap'));
      return [def.id, def.tier ?? '?', ...cells, failed ? 'FAIL' : 'ok'];
    });
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells: string[]): string => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
    const out = [this.title, '', line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)];

    const failures = this.entries.filter((e) => e.outcome === 'fail' || e.outcome === 'stale-gap');
    if (failures.length > 0) {
      out.push('', 'Failures:');
      for (const e of failures) {
        out.push(`  FAIL ${e.language} / ${e.check}: ${e.outcome === 'stale-gap' ? `stale known gap — ${e.detail}` : e.detail}`);
      }
    }
    const gaps = this.entries.filter((e) => e.outcome === 'gap');
    if (gaps.length > 0) {
      out.push('', 'Known gaps (expected failures, see each expected.json):');
      for (const e of gaps) out.push(`  gap  ${e.language} / ${e.check}: ${e.detail}`);
    }
    return out.join('\n');
  }

  /**
   * Prints the table and, when `HESMAN_CONFORMANCE_REPORT` names a directory,
   * writes `<name>.md` and `<name>.json` there for a CI step to publish.
   */
  publish(languages: readonly LanguageDefinition[], name: string): void {
    const text = this.render(languages);
    console.log(`\n${text}\n`);
    const dir = process.env.HESMAN_CONFORMANCE_REPORT;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), `${text}\n`);
    writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(this.toJSON(languages), null, 2)}\n`);
  }
}

function describeGap(gap: KnownGap): string {
  return `${gap.file}${gap.subject ? ` ${gap.subject}` : ''} (${gap.check}): ${gap.reason} [fixed by ${gap.fixedBy}]`;
}

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n', 1)[0];
}
