import { describe, it, expect } from 'vitest';
import { tsProfile, tsxProfile } from '../../../src/parsers/profiles/typescript';
import { languageById } from '../../../src/parsers/languages';

describe('tsProfile', () => {
  it('has correct metadata', () => {
    expect(tsProfile.language).toBe('typescript');
    expect(tsProfile.extensions).toEqual(['.ts', '.mts', '.cts']);
  });

  it('shares its hooks with the TSX profile, which only differs in the grammar', () => {
    expect(tsxProfile.language).toBe('tsx');
    expect(tsxProfile.extensions).toEqual(['.tsx']);
    expect(tsxProfile.parserWasmPath).toContain('tree-sitter-tsx.wasm');
    expect(tsxProfile.includeDefinition).toBe(tsProfile.includeDefinition);
  });

  it('gets its symbols from tags queries, not from a node-type table', () => {
    expect(tsProfile).not.toHaveProperty('symbolNodeTypes');
    expect(languageById('typescript')?.tagsQuery).toEqual([
      'javascript/tags.scm',
      'typescript/tags.scm',
      'typescript/hesman-tags.scm',
      'javascript/hesman-relations.scm',
    ]);
  });

  it('has parser WASM path', () => {
    expect(tsProfile.parserWasmPath).toContain('tree-sitter-typescript.wasm');
  });
});
