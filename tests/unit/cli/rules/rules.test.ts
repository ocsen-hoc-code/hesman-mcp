import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENT_IDS, type ClientId } from '../../../../src/cli/clients/types';
import { RULES_BLOCK, RULES_START } from '../../../../src/cli/rules/block';
import { applyRules, removeRules, rulesTargetFor } from '../../../../src/cli/rules/index';
import { cleanupEnvs, makeEnv, writeFixture } from '../clients/helpers';

afterEach(cleanupEnvs);

const clients = (...ids: ClientId[]) => ids.map((id) => ({ id, label: `Label of ${id}` }));
const ALL = clients(...CLIENT_IDS);

/** Every entry under `dir`, files and directories, relative and sorted. */
function tree(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).map((p) => p.split('\\').join('/')).sort();
}

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

describe('rulesTargetFor', () => {
  it('names the project instruction file of each client', () => {
    const files = Object.fromEntries(CLIENT_IDS.map((id) => [id, rulesTargetFor(id).file]));

    expect(files).toEqual({
      'claude-code': 'CLAUDE.md',
      'claude-desktop': undefined,
      codex: 'AGENTS.md',
      cursor: '.cursor/rules/hesman.mdc',
      antigravity: 'GEMINI.md',
      vscode: '.github/copilot-instructions.md',
      'gemini-cli': 'GEMINI.md',
      windsurf: 'AGENTS.md',
    });
  });

  it('says why a client without a project instruction file is skipped', () => {
    expect(rulesTargetFor('claude-desktop').skip).toMatch(/no project instruction file/);
  });
});

describe('applyRules', () => {
  it('writes the block once into each instruction file, also when clients share one', () => {
    const { cwd } = makeEnv();

    const outcome = applyRules(cwd, ALL, {});

    expect(tree(cwd)).toEqual([
      '.cursor',
      '.cursor/rules',
      '.cursor/rules/hesman.mdc',
      '.github',
      '.github/copilot-instructions.md',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
    ]);
    for (const file of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursor/rules/hesman.mdc']) {
      expect(occurrences(readFileSync(join(cwd, file), 'utf-8'), RULES_START)).toBe(1);
    }
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toBe(`${RULES_BLOCK}\n`);
    const gemini = outcome.files.find((f) => f.file === 'GEMINI.md')!;
    expect(gemini.clients).toEqual(['Label of antigravity', 'Label of gemini-cli']);
    expect(outcome.files.every((f) => f.status === 'created' && f.applied)).toBe(true);
    expect(outcome.skipped.map((s) => s.client)).toEqual(['Label of claude-desktop']);
  });

  it('gives the Cursor rule file front matter that makes Cursor always apply it', () => {
    const { cwd } = makeEnv();

    applyRules(cwd, clients('cursor'), {});

    const text = readFileSync(join(cwd, '.cursor/rules/hesman.mdc'), 'utf-8');
    expect(text.startsWith('---\ndescription: ')).toBe(true);
    expect(text).toContain('\nalwaysApply: true\n---\n\n' + RULES_START);
  });

  it('appends to an existing file, keeps its content and reports the backup', () => {
    const { cwd } = makeEnv();
    const path = join(cwd, 'CLAUDE.md');
    writeFixture(path, '# Mine\n');

    const outcome = applyRules(cwd, clients('claude-code'), {});

    expect(readFileSync(path, 'utf-8')).toBe(`# Mine\n\n${RULES_BLOCK}\n`);
    expect(outcome.files[0]).toMatchObject({ status: 'added', applied: true, path, backupPath: `${path}.hesman.bak` });
    expect(readFileSync(`${path}.hesman.bak`, 'utf-8')).toBe('# Mine\n');
  });

  it('is idempotent: a second run changes nothing and reports that', () => {
    const { cwd } = makeEnv();
    writeFixture(join(cwd, 'AGENTS.md'), '# Mine\n');
    applyRules(cwd, ALL, {});
    const before = tree(cwd);
    const text = readFileSync(join(cwd, 'AGENTS.md'), 'utf-8');

    const outcome = applyRules(cwd, ALL, {});

    expect(outcome.files.every((f) => f.status === 'unchanged' && !f.applied)).toBe(true);
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf-8')).toBe(text);
    expect(occurrences(text, RULES_START)).toBe(1);
    expect(tree(cwd)).toEqual(before);
  });

  it('replaces an outdated block in place', () => {
    const { cwd } = makeEnv();
    const path = join(cwd, 'AGENTS.md');
    writeFixture(path, `top\n\n${RULES_START}\nold\n<!-- hesman:rules:end -->\n\nbottom\n`);

    const outcome = applyRules(cwd, clients('codex'), {});

    expect(outcome.files[0].status).toBe('updated');
    expect(readFileSync(path, 'utf-8')).toBe(`top\n\n${RULES_BLOCK}\n\nbottom\n`);
  });

  it('dry run reports the change and writes nothing', () => {
    const { cwd } = makeEnv();
    writeFixture(join(cwd, 'CLAUDE.md'), '# Mine\n');

    const outcome = applyRules(cwd, ALL, { dryRun: true });

    expect(tree(cwd)).toEqual(['CLAUDE.md']);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toBe('# Mine\n');
    expect(outcome.files.map((f) => f.status).sort()).toEqual(['added', 'created', 'created', 'created', 'created']);
    expect(outcome.files.every((f) => !f.applied)).toBe(true);
  });

  it('a file with damaged markers fails alone and is left untouched', () => {
    const { cwd } = makeEnv();
    const damaged = `x\n${RULES_START}\nno end\n`;
    writeFixture(join(cwd, 'CLAUDE.md'), damaged);

    const outcome = applyRules(cwd, clients('claude-code', 'codex'), {});

    expect(outcome.files.map((f) => f.status)).toEqual(['failed', 'created']);
    expect(outcome.files[0].error).toMatch(/marker/);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf-8')).toBe(damaged);
  });
});

describe('removeRules', () => {
  it('after apply it restores every file byte for byte and deletes what Hesman created', () => {
    const { cwd } = makeEnv();
    const originals: Record<string, string> = {
      'CLAUDE.md': '# Claude\n\nRules.\n',
      'AGENTS.md': 'no final newline',
      '.github/copilot-instructions.md': '# Copilot\r\n\r\nCRLF file\r\n',
      '.github/workflows/ci.yml': 'on: push\n',
    };
    for (const [file, text] of Object.entries(originals)) writeFixture(join(cwd, file), text);
    const before = tree(cwd);
    applyRules(cwd, ALL, {});

    const outcome = removeRules(cwd, ALL, {});

    expect(tree(cwd)).toEqual(before);
    for (const [file, text] of Object.entries(originals)) expect(readFileSync(join(cwd, file), 'utf-8')).toBe(text);
    expect(Object.fromEntries(outcome.files.map((f) => [f.file, f.status]))).toEqual({
      'CLAUDE.md': 'removed',
      'AGENTS.md': 'removed',
      '.cursor/rules/hesman.mdc': 'deleted',
      'GEMINI.md': 'deleted',
      '.github/copilot-instructions.md': 'removed',
    });
  });

  it('on a project that had no instruction files it leaves nothing behind', () => {
    const { cwd } = makeEnv();
    applyRules(cwd, ALL, {});

    removeRules(cwd, ALL, {});

    expect(tree(cwd)).toEqual([]);
  });

  it('keeps what the user wrote around the block after setup', () => {
    const { cwd } = makeEnv();
    const path = join(cwd, 'GEMINI.md');
    applyRules(cwd, clients('gemini-cli'), {});
    writeFixture(path, `# Added later\n\n${readFileSync(path, 'utf-8')}`);

    const outcome = removeRules(cwd, clients('gemini-cli'), {});

    expect(outcome.files[0].status).toBe('removed');
    expect(readFileSync(path, 'utf-8')).toBe('# Added later\n');
  });

  it('reports files without the block as absent and does not touch them', () => {
    const { cwd } = makeEnv();
    writeFixture(join(cwd, 'CLAUDE.md'), '# Mine\n');

    const outcome = removeRules(cwd, ALL, {});

    expect(outcome.files.every((f) => f.status === 'absent' && !f.applied)).toBe(true);
    expect(tree(cwd)).toEqual(['CLAUDE.md']);
  });

  it('dry run removes nothing', () => {
    const { cwd } = makeEnv();
    applyRules(cwd, ALL, {});
    const before = tree(cwd);

    const outcome = removeRules(cwd, ALL, { dryRun: true });

    expect(tree(cwd)).toEqual(before);
    expect(outcome.files.every((f) => f.status === 'deleted' && !f.applied)).toBe(true);
  });
});
