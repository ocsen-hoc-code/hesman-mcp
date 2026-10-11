import { existsSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { backupPathFor, writeConfigAtomically } from '../config-writer.js';
import type { ClientId } from '../clients/types.js';
import { RULES_BLOCK, hasRulesBlock, stripRulesBlock, upsertRulesBlock } from './block.js';

/** Where a client reads project instructions, or why Hesman writes none for it. */
export interface RulesTarget {
  /** Path relative to the project directory, with forward slashes. Undefined: nothing is written. */
  file?: string;
  /** Front matter for a file Hesman creates and owns; never added to an existing file. */
  header?: string;
  /** Printed when `file` is undefined. */
  skip?: string;
}

/**
 * Cursor project rule. Source: https://cursor.com/docs/context/rules (read 2026-10-11): project
 * rules live in `.cursor/rules`, must use the `.mdc` extension (a plain `.md` there is ignored),
 * and start with front matter `description`, `globs`, `alwaysApply`; with `alwaysApply: true` the
 * rule is included in every chat session and the other two fields are ignored.
 */
const CURSOR_HEADER = ['---', 'description: When to use the Hesman MCP tools instead of grep or reading whole files', 'alwaysApply: true', '---', ''].join('\n');

/**
 * The project instruction file per client, all read 2026-10-11:
 * - Claude Code: `./CLAUDE.md` — https://code.claude.com/docs/en/memory (block-level HTML comments,
 *   such as the markers, are stripped before the file reaches the model).
 * - Codex CLI: `AGENTS.md`, from the project root down to the working directory —
 *   https://developers.openai.com/codex/guides/agents-md
 * - Gemini CLI: `GEMINI.md` in the workspace directories and their parents —
 *   https://geminicli.com/docs/cli/gemini-md/
 * - Antigravity: `AGENTS.md`, `GEMINI.md` or `.agents/rules/*.md` in the workspace root —
 *   https://antigravity.google/docs/rules. `GEMINI.md` is used so it shares one file with Gemini CLI.
 * - VS Code (Copilot): `.github/copilot-instructions.md` —
 *   https://code.visualstudio.com/docs/copilot/customization/custom-instructions
 * - Windsurf: a root-level `AGENTS.md` is always on, without front matter —
 *   https://docs.windsurf.com/windsurf/cascade/memories (redirects to docs.devin.ai). It is used
 *   instead of a rule file under `.devin/rules/` so the block is shared with Codex CLI.
 * - Claude Desktop has no project and reads no project file.
 */
const TARGETS: Record<ClientId, RulesTarget> = {
  'claude-code': { file: 'CLAUDE.md' },
  'claude-desktop': { skip: 'it reads no project instruction file' },
  codex: { file: 'AGENTS.md' },
  cursor: { file: '.cursor/rules/hesman.mdc', header: CURSOR_HEADER },
  antigravity: { file: 'GEMINI.md' },
  vscode: { file: '.github/copilot-instructions.md' },
  'gemini-cli': { file: 'GEMINI.md' },
  windsurf: { file: 'AGENTS.md' },
};

export function rulesTargetFor(id: ClientId): RulesTarget {
  return TARGETS[id];
}

export type RulesStatus =
  /** The file did not exist and now holds the block. */
  | 'created'
  /** The block was appended to an existing file. */
  | 'added'
  /** An older block was replaced in place. */
  | 'updated'
  | 'unchanged'
  /** The block was taken out of a file that has other content. */
  | 'removed'
  /** The file held nothing but the block and was deleted. */
  | 'deleted'
  /** There was no block to remove. */
  | 'absent'
  | 'failed';

export interface RulesFileResult {
  /** Relative to the project directory. */
  file: string;
  path: string;
  /** Labels of the selected clients that read this file. */
  clients: string[];
  status: RulesStatus;
  /** False for dry runs and for `unchanged` / `absent` / `failed`. */
  applied: boolean;
  backupPath?: string;
  /** What is written into a new file, or the block for an existing one. */
  preview: string;
  error?: string;
}

export interface RulesOutcome {
  projectDir: string;
  files: RulesFileResult[];
  skipped: { client: string; reason: string }[];
}

export interface RulesClient {
  id: ClientId;
  label: string;
}

/** The project the instruction files belong to: `--project-root` when given, else the working directory. */
export function rulesProjectDir(cwd: string, projectRoot: string | undefined): string {
  return projectRoot === undefined ? cwd : resolve(cwd, projectRoot);
}

/** The instruction files the given clients read, relative to the project, each once. */
export function rulesFilesFor(clients: readonly RulesClient[]): string[] {
  return [...new Set(clients.map((c) => TARGETS[c.id].file).filter((f): f is string => f !== undefined))];
}

const readIfExists = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, 'utf-8') : undefined);

/** Removes directories left empty between `path` and the project directory. */
function pruneEmptyDirs(path: string, projectDir: string): void {
  for (let dir = dirname(path); dir !== projectDir && dir.startsWith(projectDir); dir = dirname(dir)) {
    try {
      rmdirSync(dir);
    } catch {
      return; // Not empty (or not removable): everything above stays as well.
    }
  }
}

function forEachFile(
  projectDir: string,
  clients: readonly RulesClient[],
  change: (path: string, target: RulesTarget) => Pick<RulesFileResult, 'status' | 'applied' | 'backupPath' | 'preview'>,
): RulesOutcome {
  const outcome: RulesOutcome = { projectDir, files: [], skipped: [] };
  for (const client of clients) {
    const target = TARGETS[client.id];
    if (target.file === undefined) {
      outcome.skipped.push({ client: client.label, reason: target.skip ?? 'no instruction file is known for it' });
      continue;
    }
    const known = outcome.files.find((f) => f.file === target.file);
    if (known) {
      known.clients.push(client.label);
      continue;
    }
    const base = { file: target.file, path: join(projectDir, target.file), clients: [client.label] };
    try {
      outcome.files.push({ ...base, ...change(base.path, target) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      outcome.files.push({ ...base, status: 'failed', applied: false, preview: '', error });
    }
  }
  return outcome;
}

/** Writes the guidance block into the instruction file of each client. Idempotent. */
export function applyRules(projectDir: string, clients: readonly RulesClient[], options: { dryRun?: boolean }): RulesOutcome {
  return forEachFile(projectDir, clients, (path, target) => {
    const text = readIfExists(path);
    const content = upsertRulesBlock(text, target.header);
    const preview = text === undefined ? content.trimEnd() : RULES_BLOCK;
    if (content === text) return { status: 'unchanged', applied: false, preview };
    const status = text === undefined ? 'created' : hasRulesBlock(text) ? 'updated' : 'added';
    if (options.dryRun) return { status, applied: false, preview };
    const { backupPath } = writeConfigAtomically(path, content);
    return { status, applied: true, backupPath, preview };
  });
}

/**
 * Takes the block out again. A file that then holds nothing Hesman did not write is deleted, with
 * the directories that became empty; the `.hesman.bak` copy made by setup is deleted too, since
 * the instruction file is back to its own content.
 */
export function removeRules(projectDir: string, clients: readonly RulesClient[], options: { dryRun?: boolean }): RulesOutcome {
  return forEachFile(projectDir, clients, (path, target) => {
    const text = readIfExists(path);
    if (text === undefined || !hasRulesBlock(text)) return { status: 'absent', applied: false, preview: '' };
    const rest = stripRulesBlock(text, target.header);
    const status = rest === undefined ? 'deleted' : 'removed';
    if (options.dryRun) return { status, applied: false, preview: RULES_BLOCK };

    if (rest === undefined) rmSync(path);
    else writeConfigAtomically(path, rest);
    rmSync(backupPathFor(path), { force: true });
    if (rest === undefined) pruneEmptyDirs(path, projectDir);
    return { status, applied: true, preview: RULES_BLOCK };
  });
}
