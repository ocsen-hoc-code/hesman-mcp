import { describe, it, expect } from 'vitest';
import {
  MAX_LINE_LENGTH,
  buildLineStarts,
  compilePattern,
  lineAt,
  matchSource,
  validatePattern,
} from '../../../src/server/tools/find-pattern-matcher.js';

describe('find-pattern matcher', () => {
  it('validatePattern names the violated limit', () => {
    expect(validatePattern('console.$M($$$A)')).toBeNull();
    expect(validatePattern('x'.repeat(501))).toMatch(/limit is 500/);
    expect(validatePattern('$$$A $$$B $$$C $$$D')).toMatch(/\$\$\$ placeholders; the limit is 3/);
    expect(validatePattern('$A $B $C $D $E $F $$$G $$$H $I')).toMatch(/9 placeholders; the limit is 8/);
  });

  it('compilePattern rejects repeated capture names', () => {
    expect(() => compilePattern('$A + $A')).toThrow();
  });

  it('lineAt maps offsets to 1-based lines', () => {
    const text = 'ab\ncd\n\nef';
    const starts = buildLineStarts(text);
    expect(starts).toEqual([0, 3, 6, 7]);
    expect(lineAt(starts, 0)).toBe(1);
    expect(lineAt(starts, 2)).toBe(1);
    expect(lineAt(starts, 3)).toBe(2);
    expect(lineAt(starts, 6)).toBe(3);
    expect(lineAt(starts, 9)).toBe(4);
  });

  it('matchSource returns 1-based lines and bindings', () => {
    const src = 'a\nb\nconsole.log(x, y);\n';
    const { matches } = matchSource(src, new RegExp(compilePattern('console.$M($$$ARGS)'), 'g'), '/f.ts', 10);
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(3);
    expect(matches[0].bindings).toEqual({ M: 'log', ARGS: 'x, y' });
    expect(matches[0].snippet).toBe('a\nb\nconsole.log(x, y);\n');
  });

  it('matchSource skips overlong lines but keeps line numbering', () => {
    const long = `foo(${'x'.repeat(MAX_LINE_LENGTH)})`;
    const src = `${long}\nfoo(1)\n`;
    const { matches, skippedLines } = matchSource(src, new RegExp(compilePattern('foo($$$A)'), 'g'), '/f.js', 10);
    expect(skippedLines).toBe(1);
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(2);
    expect(matches[0].bindings.A).toBe('1');
  });

  it('matchSource stops at the limit', () => {
    const src = 'f(1)\nf(2)\nf(3)\n';
    const { matches } = matchSource(src, new RegExp(compilePattern('f($A)'), 'g'), '/f.js', 2);
    expect(matches.map((m) => m.line)).toEqual([1, 2]);
  });
});
