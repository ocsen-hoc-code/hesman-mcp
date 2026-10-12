/**
 * Profiles of the languages that need nothing beyond a grammar, a tags query
 * and a visibility rule (M1-05, the bundled core set of ADR 0001).
 *
 * `defineProfile` builds a `LanguageProfile` from data; the only code per
 * language is its `isExported` rule, each documented in one line below.
 */
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { LanguageProfile } from '../language-profile.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PARSERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'parsers');

export interface ProfileOptions {
  language: string;
  extensions: readonly string[];
  /** WASM file name inside `parsers/`. */
  grammar: string;
  /**
   * True to run the regex relation extractor (`relation-extractor.ts`) on this
   * language. Only for languages whose registry tier is `deep`; a structural
   * language stores symbols and no relations.
   */
  relations?: boolean;
  isExported?: LanguageProfile['isExported'];
  includeDefinition?: LanguageProfile['includeDefinition'];
}

/** A profile described as data. */
export function defineProfile(options: ProfileOptions): LanguageProfile {
  const profile: LanguageProfile = {
    language: options.language,
    extensions: [...options.extensions],
    parserWasmPath: join(PARSERS_DIR, options.grammar),
  };
  // The extractor only looks at whether `relationQueries` is present; the
  // queries themselves are not used until relation extraction moves to
  // Tree-sitter queries (M1-07).
  if (options.relations) profile.relationQueries = {};
  if (options.isExported) profile.isExported = options.isExported;
  if (options.includeDefinition) profile.includeDefinition = options.includeDefinition;
  return profile;
}

// ---------------------------------------------------------------------------
// Helpers shared by the visibility rules
// ---------------------------------------------------------------------------

/**
 * The modifier keywords written on a declaration (`public`, `static`, `pub`,
 * ...): the words of every direct child whose node type names a modifier or a
 * storage class. Grammars differ in nesting (`modifiers > 'public'`,
 * `modifiers > visibility_modifier > 'private'`), so the text is used.
 */
function modifierWords(node: SyntaxNode): Set<string> {
  const words = new Set<string>();
  for (const child of node.children) {
    if (!child || !/modifier|storage_class/.test(child.type)) continue;
    for (const word of child.text.split(/[^A-Za-z_]+/)) {
      if (word) words.add(word);
    }
  }
  return words;
}

function hasAnyModifier(node: SyntaxNode, keywords: readonly string[]): boolean {
  const words = modifierWords(node);
  return keywords.some((keyword) => words.has(keyword));
}

/** The nearest ancestor (or the node itself) whose type is one of `types`. */
function closest(node: SyntaxNode, types: ReadonlySet<string>): SyntaxNode | null {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (types.has(current.type)) return current;
  }
  return null;
}

/** True if a strict ancestor of `node` has one of `types`. */
function isInside(node: SyntaxNode, types: ReadonlySet<string>): boolean {
  return node.parent !== null && closest(node.parent, types) !== null;
}

// ---------------------------------------------------------------------------
// Visibility rules
// ---------------------------------------------------------------------------

const JAVA_INTERFACE_BODIES = new Set(['interface_body', 'annotation_type_body']);

/** Java: exported iff declared `public`; interface members are implicitly public, an enum constant follows its enum. */
export function isJavaExported(_name: string, node: SyntaxNode): boolean {
  if (node.type === 'enum_constant') {
    const owner = closest(node, new Set(['enum_declaration']));
    return owner !== null && isJavaExported(_name, owner);
  }
  if (node.parent && JAVA_INTERFACE_BODIES.has(node.parent.type)) return true;
  return hasAnyModifier(node, ['public']);
}

/** C#: exported iff declared `public`; interface members are implicitly public and namespaces are always visible. */
export function isCSharpExported(_name: string, node: SyntaxNode): boolean {
  if (node.type.endsWith('namespace_declaration')) return true;
  if (node.parent?.type === 'declaration_list' && node.parent.parent?.type === 'interface_declaration') return true;
  return hasAnyModifier(node, ['public']);
}

const KOTLIN_FUNCTION_SCOPES = new Set(['function_body', 'lambda_literal', 'anonymous_function']);

/** Kotlin: public by default; not exported when `private`, `internal` or `protected`, or when local to a function. */
export function isKotlinExported(_name: string, node: SyntaxNode): boolean {
  if (hasAnyModifier(node, ['private', 'internal', 'protected'])) return false;
  return !isInside(node, KOTLIN_FUNCTION_SCOPES);
}

const SWIFT_FUNCTION_SCOPES = new Set(['function_body', 'lambda_literal']);

/** Swift: visible to the rest of the module by default; not exported when `private` or `fileprivate`, or when local to a function. */
export function isSwiftExported(_name: string, node: SyntaxNode): boolean {
  if (hasAnyModifier(node, ['private', 'fileprivate'])) return false;
  return !isInside(node, SWIFT_FUNCTION_SCOPES);
}

/** PHP: top-level declarations are global; a class member is exported unless `private` or `protected`. */
export function isPhpExported(_name: string, node: SyntaxNode): boolean {
  return !hasAnyModifier(node, ['private', 'protected']);
}

/** Rust: exported iff it has a visibility modifier (`pub`, `pub(crate)`, ...); items of a trait impl follow the trait. */
export function isRustExported(_name: string, node: SyntaxNode): boolean {
  if (hasAnyModifier(node, ['pub'])) return true;
  const owner = node.parent?.type === 'declaration_list' ? node.parent.parent : null;
  return owner?.type === 'impl_item' && owner.childForFieldName('trait') !== null;
}

const RUBY_VISIBILITY = new Set(['private', 'protected', 'public']);

/** Ruby: public by default; not exported after a bare `private`/`protected` in the same body, or as `private def ...`. */
export function isRubyExported(_name: string, node: SyntaxNode): boolean {
  const wrapper = node.parent?.type === 'argument_list' ? node.parent.parent : null;
  const inline = wrapper?.type === 'call' ? wrapper.childForFieldName('method')?.text : undefined;
  if (inline && RUBY_VISIBILITY.has(inline)) return inline === 'public';
  for (let prev = node.previousNamedSibling; prev; prev = prev.previousNamedSibling) {
    if (prev.type === 'identifier' && RUBY_VISIBILITY.has(prev.text)) return prev.text === 'public';
  }
  return true;
}

const LUA_FUNCTION_SCOPES = new Set(['function_declaration', 'function_definition']);

/** Lua: exported unless declared `local` or defined inside another function. */
export function isLuaExported(_name: string, node: SyntaxNode): boolean {
  const declaration = node.parent?.type === 'variable_declaration' ? node.parent : node;
  if (declaration.firstChild?.type === 'local') return false;
  return !isInside(node, LUA_FUNCTION_SCOPES);
}

/** Bash: every function and top-level variable is visible to whoever sources the script; a leading `_` marks a private helper. */
export function isBashExported(name: string, _node: SyntaxNode): boolean {
  return !name.startsWith('_');
}

const C_DECLARATIONS = new Set(['function_definition', 'declaration', 'field_declaration']);

function isStatic(node: SyntaxNode): boolean {
  const declaration = closest(node, C_DECLARATIONS);
  return declaration !== null && hasAnyModifier(declaration, ['static']);
}

/** C: exported (external linkage) unless declared `static`. */
export function isCExported(_name: string, node: SyntaxNode): boolean {
  return !isStatic(node);
}

const CPP_FUNCTION_SCOPES = new Set(['compound_statement', 'lambda_expression']);

/**
 * C++: not exported when `static` at namespace scope, inside an anonymous
 * namespace, local to a function, or a class member under `private:` /
 * `protected:` (the default of `class`; `struct` and `union` default to public).
 */
export function isCppExported(_name: string, node: SyntaxNode): boolean {
  if (isInside(node, CPP_FUNCTION_SCOPES)) return false;
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (current.type === 'namespace_definition' && current.childForFieldName('name') === null && current !== node) return false;
  }

  let member: SyntaxNode | null = node;
  while (member && member.parent?.type !== 'field_declaration_list') member = member.parent;
  if (!member) return !isStatic(node);

  for (let prev = member.previousNamedSibling; prev; prev = prev.previousNamedSibling) {
    if (prev.type === 'access_specifier') return prev.text === 'public';
  }
  return member.parent?.parent?.type !== 'class_specifier';
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** JavaScript and JSX. Exported iff inside an `export` statement (the default rule in `core.ts`). */
export const javascriptProfile = defineProfile({
  language: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  grammar: 'tree-sitter-javascript.wasm',
  relations: true,
});

export const javaProfile = defineProfile({
  language: 'java',
  extensions: ['.java'],
  grammar: 'tree-sitter-java.wasm',
  relations: true,
  isExported: isJavaExported,
});

export const cProfile = defineProfile({
  language: 'c',
  extensions: ['.c', '.h'],
  grammar: 'tree-sitter-c.wasm',
  isExported: isCExported,
});

export const cppProfile = defineProfile({
  language: 'cpp',
  extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.ipp', '.tpp'],
  grammar: 'tree-sitter-cpp.wasm',
  isExported: isCppExported,
});

export const csharpProfile = defineProfile({
  language: 'csharp',
  extensions: ['.cs', '.csx'],
  grammar: 'tree-sitter-c_sharp.wasm',
  relations: true,
  isExported: isCSharpExported,
});

export const rustProfile = defineProfile({
  language: 'rust',
  extensions: ['.rs'],
  grammar: 'tree-sitter-rust.wasm',
  relations: true,
  isExported: isRustExported,
});

export const phpProfile = defineProfile({
  language: 'php',
  extensions: ['.php', '.phtml'],
  grammar: 'tree-sitter-php.wasm',
  relations: true,
  isExported: isPhpExported,
});

export const rubyProfile = defineProfile({
  language: 'ruby',
  extensions: ['.rb', '.rake', '.gemspec', '.ru', '.podspec'],
  grammar: 'tree-sitter-ruby.wasm',
  isExported: isRubyExported,
});

export const kotlinProfile = defineProfile({
  language: 'kotlin',
  extensions: ['.kt', '.kts'],
  grammar: 'tree-sitter-kotlin.wasm',
  relations: true,
  isExported: isKotlinExported,
});

export const swiftProfile = defineProfile({
  language: 'swift',
  extensions: ['.swift'],
  grammar: 'tree-sitter-swift.wasm',
  relations: true,
  isExported: isSwiftExported,
});

export const bashProfile = defineProfile({
  language: 'bash',
  extensions: ['.sh', '.bash'],
  grammar: 'tree-sitter-bash.wasm',
  isExported: isBashExported,
});

export const luaProfile = defineProfile({
  language: 'lua',
  extensions: ['.lua'],
  grammar: 'tree-sitter-lua.wasm',
  relations: true,
  isExported: isLuaExported,
});
