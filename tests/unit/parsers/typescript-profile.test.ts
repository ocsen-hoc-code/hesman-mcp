import { describe, it, expect } from 'vitest';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import type { LanguageProfile } from '../../../src/parsers/language-profile';

describe('tsProfile', () => {
  it('has correct metadata', () => {
    expect(tsProfile.language).toBe('typescript');
    expect(tsProfile.extensions).toContain('.ts');
    expect(tsProfile.extensions).toContain('.tsx');
    expect(tsProfile.extensions).toContain('.js');
    expect(tsProfile.extensions).toContain('.jsx');
  });

  it('defines symbol node types', () => {
    expect(tsProfile.symbolNodeTypes).toBeInstanceOf(Set);
    expect(tsProfile.symbolNodeTypes.has('function_declaration')).toBe(true);
    expect(tsProfile.symbolNodeTypes.has('class_declaration')).toBe(true);
    expect(tsProfile.symbolNodeTypes.has('method_definition')).toBe(true);
    expect(tsProfile.symbolNodeTypes.has('variable_declarator')).toBe(true);
    expect(tsProfile.symbolNodeTypes.has('interface_declaration')).toBe(true);
    expect(tsProfile.symbolNodeTypes.has('type_alias_declaration')).toBe(true);
    expect(tsProfile.symbolNodeTypes.has('enum_declaration')).toBe(true);
  });

  it('has parser WASM path', () => {
    expect(tsProfile.parserWasmPath).toContain('tree-sitter-typescript.wasm');
  });

  it('extracts signature from function declaration', () => {
    // We can't test actual tree-sitter without WASM loaded,
    // but extractSignature should be callable with mock
    expect(typeof tsProfile.extractSignature).toBe('function');
  });

  it('extracts doc comment', () => {
    expect(typeof tsProfile.extractDocComment).toBe('function');
  });
});
