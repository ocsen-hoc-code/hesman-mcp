import { describe, it, expect } from 'vitest';
import { compactCode } from '../../../src/parsers/compact-mode';

describe('compactCode — level 2 (AST-aware)', () => {
  it('keeps JSDoc before function declarations', () => {
    const input = `/**
 * Add two numbers.
 * @param a - first
 * @param b - second
 */
export function add(a: number, b: number): number {
  // implementation
  return a + b;
}`;
    const result = compactCode(input, { level: 2 });
    expect(result).toContain('Add two numbers');
    expect(result).toContain('export function add');
    expect(result).not.toContain('// implementation');
  });

  it('strips non-JSDoc block comments', () => {
    const input = `/* TODO: refactor */
function helper() { return 1; }`;
    const result = compactCode(input, { level: 2 });
    expect(result).not.toContain('TODO: refactor');
    expect(result).toContain('function helper');
  });

  it('collapses multiple blank lines into one', () => {
    const input = 'function a() {}\n\n\n\nfunction b() {}';
    const result = compactCode(input, { level: 2 });
    const blankLines = result.split('\n').filter(l => l.trim() === '').length;
    expect(blankLines).toBeLessThanOrEqual(1);
  });

  it('removes unused imports when removeUnusedImports is true', () => {
    const input = `import { foo, bar } from './lib';
import { baz } from './other';

export function main() {
  return foo();
}`;
    const result = compactCode(input, { level: 2, removeUnusedImports: true });
    expect(result).toContain('foo');
    expect(result).not.toContain('bar');
    expect(result).not.toContain('baz');
  });

  it('level 1 preserves Phase 2 behavior', () => {
    const input = '// comment\nfunction a() {\n  return 1;\n}';
    const result = compactCode(input, { level: 1 });
    expect(result).not.toContain('// comment');
    expect(result).toContain('function a');
  });
});
