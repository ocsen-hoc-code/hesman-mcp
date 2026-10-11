import { describe, it, expect } from 'vitest';
import { registerAllTools } from '../../../../src/server/tools/index';
import { RULES_BLOCK, RULES_END, RULES_START, hasRulesBlock, stripRulesBlock, upsertRulesBlock } from '../../../../src/cli/rules/block';

/** The tool names the server really registers, taken from the registration code itself. */
function registeredToolNames(): string[] {
  const names: string[] = [];
  const server = { registerTool: (name: string) => names.push(name) };
  // Registration only stores the handlers; nothing touches the stores or the config.
  registerAllTools(server as never, {} as never, {} as never, {} as never);
  return names;
}

describe('the guidance block', () => {
  const lines = RULES_BLOCK.split('\n');

  it('is at most 15 lines, markers included', () => {
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(lines[0]).toBe(RULES_START);
    expect(lines[lines.length - 1]).toBe(RULES_END);
  });

  it('mentions only tools the server registers', () => {
    const tools = registeredToolNames();
    expect(tools.length).toBeGreaterThanOrEqual(11);
    const mentioned = [...RULES_BLOCK.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
    expect(mentioned.length).toBeGreaterThan(0);
    for (const name of mentioned) expect(tools, `\`${name}\` is not a Hesman tool`).toContain(name);
  });

  it('covers the questions it exists for', () => {
    for (const tool of ['find_symbol', 'get_context', 'get_callers', 'get_callees', 'impact_analysis', 'semantic_search', 'index_status']) {
      expect(RULES_BLOCK).toContain(`\`${tool}\``);
    }
    expect(RULES_BLOCK).toContain('1-based');
    expect(RULES_BLOCK).toContain('precision: "text"');
  });

  it('makes no token-saving or percentage claims', () => {
    expect(RULES_BLOCK).not.toMatch(/%|\btokens?\b|\bsav(e|es|ing)\b|\bfaster\b/i);
  });

  it('is plain text without carriage returns or trailing spaces', () => {
    expect(RULES_BLOCK).not.toMatch(/\r|[ \t]+$/m);
  });
});

const ORIGINALS: [string, string | undefined][] = [
  ['a missing file', undefined],
  ['an empty file', ''],
  ['a file without a final newline', '# Project\n\nSome rules.'],
  ['a file with a final newline', '# Project\n\nSome rules.\n'],
  ['a file ending in blank lines', '# Project\n\n\n'],
  ['a file that is one newline', '\n'],
  ['a CRLF file', '# Project\r\n\r\nSome rules.\r\n'],
  ['a CRLF file without a final newline', '# Project\r\nSome rules.'],
];

describe('upsertRulesBlock / stripRulesBlock', () => {
  it.each(ORIGINALS)('adding then removing restores %s exactly', (_name, original) => {
    const withBlock = upsertRulesBlock(original);

    expect(hasRulesBlock(withBlock)).toBe(true);
    expect(stripRulesBlock(withBlock)).toBe(original);
  });

  it.each(ORIGINALS)('adding twice changes nothing the second time (%s)', (_name, original) => {
    const once = upsertRulesBlock(original);

    expect(upsertRulesBlock(once)).toBe(once);
  });

  it('never changes the original content, and separates the block with one blank line', () => {
    expect(upsertRulesBlock('# Project\n')).toBe(`# Project\n\n${RULES_BLOCK}\n`);
    expect(upsertRulesBlock('# Project')).toBe(`# Project\n\n${RULES_BLOCK}`);
    expect(upsertRulesBlock(undefined)).toBe(`${RULES_BLOCK}\n`);
  });

  it('uses the line endings of a CRLF file', () => {
    const withBlock = upsertRulesBlock('# Project\r\n');

    expect(withBlock.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('replaces an outdated block in place and keeps everything around it', () => {
    const outdated = `intro\n\n${RULES_START}\nold advice\n${RULES_END}\n\noutro\n`;

    const updated = upsertRulesBlock(outdated);

    expect(updated).toBe(`intro\n\n${RULES_BLOCK}\n\noutro\n`);
    expect(stripRulesBlock(updated)).toBe('intro\n\noutro\n');
  });

  it('keeps text the user wrote after the block', () => {
    const edited = `${upsertRulesBlock('# Project\n')}\n## Later section\n`;

    expect(stripRulesBlock(edited)).toBe('# Project\n\n## Later section\n');
  });

  it('reports a file without the block as unchanged', () => {
    expect(hasRulesBlock('# Project\n')).toBe(false);
    expect(stripRulesBlock('# Project\n')).toBe('# Project\n');
  });

  it('refuses a file whose markers are damaged instead of guessing', () => {
    expect(() => upsertRulesBlock(`a\n${RULES_START}\nb\n`)).toThrow(/marker/);
    expect(() => stripRulesBlock(`a\n${RULES_END}\nb\n`)).toThrow(/marker/);
    expect(() => stripRulesBlock(`${RULES_BLOCK}\n${RULES_BLOCK}\n`)).toThrow(/marker/);
  });

  describe('with a header (a file Hesman owns, such as a Cursor rule)', () => {
    const header = '---\ndescription: x\nalwaysApply: true\n---\n';

    it('a new file starts with the header and is deleted again on removal', () => {
      const created = upsertRulesBlock(undefined, header);

      expect(created).toBe(`${header}\n${RULES_BLOCK}\n`);
      expect(stripRulesBlock(created, header)).toBeUndefined();
    });

    it('an existing file gets no second header', () => {
      expect(upsertRulesBlock('mine\n', header)).toBe(`mine\n\n${RULES_BLOCK}\n`);
    });

    it('a file the user added to is kept', () => {
      const edited = `${upsertRulesBlock(undefined, header)}\nmy own rule\n`;

      expect(stripRulesBlock(edited, header)).toBe(`${header}\nmy own rule\n`);
    });
  });
});
