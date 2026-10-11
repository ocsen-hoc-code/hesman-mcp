import { describe, it, expect } from 'vitest';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { languageById } from '../../../src/parsers/languages';

describe('tsProfile', () => {
  it('has correct metadata', () => {
    expect(tsProfile.language).toBe('typescript');
    expect(tsProfile.extensions).toContain('.ts');
    expect(tsProfile.extensions).toContain('.tsx');
    expect(tsProfile.extensions).toContain('.js');
    expect(tsProfile.extensions).toContain('.jsx');
  });

  it('gets its symbols from tags queries, not from a node-type table', () => {
    expect(tsProfile).not.toHaveProperty('symbolNodeTypes');
    expect(languageById('typescript')?.tagsQuery).toEqual([
      'javascript/tags.scm',
      'typescript/tags.scm',
      'typescript/hesman-tags.scm',
    ]);
  });

  it('has parser WASM path', () => {
    expect(tsProfile.parserWasmPath).toContain('tree-sitter-typescript.wasm');
  });
});
