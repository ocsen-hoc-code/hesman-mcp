import { describe, it, expect } from 'vitest';
import { compactCode } from '../../../src/parsers/compact-mode';

describe('compactCode', () => {
  it('strips line comments', () => {
    const input = 'const x = 1; // this is a comment\nconst y = 2;';
    const result = compactCode(input);
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('this is a comment');
    expect(result).toContain('const y = 2;');
  });

  it('strips block comments', () => {
    const input = 'const x = 1; /* inline block */ const y = 2;\n/* multi\n   line\n   block */\nconst z = 3;';
    const result = compactCode(input);
    expect(result).toContain('const x = 1;');
    expect(result).toContain('const y = 2;');
    expect(result).toContain('const z = 3;');
    expect(result).not.toContain('inline block');
    expect(result).not.toContain('multi');
  });

  it('strips JSDoc comments', () => {
    const input = '/**\n * Adds two numbers.\n * @param a - first\n * @param b - second\n */\nfunction add(a: number, b: number): number {\n  return a + b;\n}';
    const result = compactCode(input);
    expect(result).toContain('function add');
    expect(result).not.toContain('@param');
    expect(result).not.toContain('Adds two numbers');
  });

  it('preserves magic comments', () => {
    const input = '// @ts-ignore\nconst x: any = getData();\n// eslint-disable-next-line\nconsole.log(x);';
    const result = compactCode(input);
    expect(result).toContain('// @ts-ignore');
    expect(result).toContain('// eslint-disable-next-line');
  });

  it('preserves ts-expect-error and ts-nocheck', () => {
    const input = '// @ts-expect-error — legacy API\nlegacyCall();\n// @ts-nocheck\n';
    const result = compactCode(input);
    expect(result).toContain('// @ts-expect-error');
    expect(result).toContain('// @ts-nocheck');
  });

  it('collapses consecutive blank lines', () => {
    const input = 'line1\n\n\n\nline2\n\n\nline3';
    const result = compactCode(input);
    const lines = result.split('\n');
    expect(lines.filter(l => l === '').length).toBeLessThanOrEqual(3);
  });

  it('strips trailing whitespace', () => {
    const input = 'const x = 1;   \nconst y = 2;\t\n';
    const result = compactCode(input);
    expect(result).not.toContain('   ');
    expect(result).not.toContain('\t');
  });

  it('does not strip // inside string literals', () => {
    const input = 'const url = "https://example.com/api";\nconst path = `//foo//bar`;';
    const result = compactCode(input);
    expect(result).toContain('https://example.com/api');
  });

  it('handles empty input', () => {
    const result = compactCode('');
    expect(result).toBe('\n');
  });

  it('handles input with only comments', () => {
    const input = '// just a comment\n/* another comment */';
    const result = compactCode(input);
    expect(result.trim()).toBe('');
  });
});
