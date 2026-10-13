/**
 * The declared type of a call's receiver (M1-10), read from the syntax tree of
 * the file without a type checker.
 *
 * A receiver `x` in `x.m()` is typed by the declaration of `x` that is nearest
 * to the call: a typed declaration or parameter (`x: T`, `T x`, `x *T`,
 * `var x T`, `x: &T`), or a value that constructs one (`new T()`, `T()`,
 * `T::new()`, `T{}`, `&T{}`). A receiver `this.f` / `self.f` is typed by a
 * typed field of the enclosing class or by an assignment of `this.f` in one of
 * its methods. Anything else has no type (`null`).
 *
 * The declarations are found by the grammar's field names, which are shared by
 * the grammars Hesman parses (`name` / `pattern` / `left`, `type`, `value` /
 * `right`, `declarator`, `operand`, `constructor`, `function`), not by a rule
 * per language. A type is the name its declaration gives, with its generic
 * arguments and its reference or pointer markers removed; a qualified name
 * keeps its last segment. A type that is not a plain name (`Store[]`,
 * `A | B`, `Optional[T]`, `interface{}`) is not read, so it is not a type.
 *
 * Two declarations of the receiver in the same scope that do not give the same
 * type make the receiver untyped. A constructed value is recorded as the name
 * it was built from, which may be a function (`make()`): the resolver checks it
 * against the symbols of the project.
 */
import type { Node } from 'web-tree-sitter';

/** Declared types longer than this are not read. */
const MAX_TYPE_LENGTH = 200;
/** `this.f` / `self.f`: the receiver of a field of the enclosing class. */
const FIELD_RECEIVER = /^(?:this|self)\.([A-Za-z_$][\w$]*)$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** A plain name, optionally qualified (`pkg.Name`, `ns::Name`, `a\B`). */
const QUALIFIED_NAME = /^[A-Za-z_$][\w$]*(?:\s*(?:::|\.|\\)\s*[A-Za-z_$][\w$]*)*$/;
/** Declared types that say the type is inferred from the value (`var`, `let`, `auto`). */
const INFERRED_TYPE_KEYWORDS: ReadonlySet<string> = new Set(['var', 'let', 'auto', 'val', 'const', 'final']);
/** Node types that open a scope for the declarations inside them. */
const FUNCTION_SCOPE = /(function|method|lambda|closure|func_literal|arrow_function|constructor)/;
const FUNCTION_SCOPE_EXCLUDED = /(invocation|call|reference|expression)/;
const CLASS_SCOPE = /(class|interface|trait|impl_item|struct_item|struct_specifier|struct_type|protocol)/;
const CLASS_SCOPE_EXCLUDED = /(expression|literal|instance|creation)/;
/** Values that wrap the value they construct: `&T{}` (Go), `(new T())`, `&T::new()` (Rust). */
const WRAPPER_VALUE = /^(?:unary_expression|reference_expression|parenthesized_expression)$/;
/** Values that construct an object: `new T()` (TypeScript, JavaScript), `new T()` (Java, C#). */
const CREATION_VALUE = /(^|_)(new_expression|object_creation_expression)$/;
/** Values that build a value of a struct or class: `T{...}` (Go), `T { ... }` (Rust). */
const LITERAL_VALUE = /^(?:composite_literal|struct_expression)$/;
/** Calls: `f()`, `T()` (Python, TypeScript) and `T::new()` (Rust, through the callee). */
const CALL_VALUE = /^(?:call|call_expression)$/;
/** A callee with a qualifier: `T::new`, `T.new`, `pkg.New`. */
const QUALIFIED_CALLEE = /(scoped_identifier|member_expression|attribute|selector_expression|field_expression)$/;

/** A declaration found in a scope, before its type is read. */
interface Declaration {
  name: Node;
  type: Node | null;
  value: Node | null;
}

/** The declared type of `node` (a type annotation or a type node), or null. */
export function declaredTypeName(node: Node): string | null {
  if (node.text.length > MAX_TYPE_LENGTH) return null;
  let text = node.text.trim().replace(/^:\s*/, '');
  // Reference, pointer and modifier markers in front of the type.
  text = text.replace(/^(?:&\s*(?:mut\s+)?|\*+\s*|dyn\s+|impl\s+|mut\s+|const\s+)+/, '');
  const generic = text.indexOf('<');
  let head = (generic >= 0 ? text.slice(0, generic) : text).trim();
  head = head.replace(/\?$/, '').trim();
  if (INFERRED_TYPE_KEYWORDS.has(head)) return null;
  return plainName(head);
}

/** The last segment of a qualified name (`java.util.List` → `List`), or null when `text` is not a name. */
function plainName(text: string): string | null {
  if (!QUALIFIED_NAME.test(text)) return null;
  const segments = text.split(/::|\.|\\/).map((s) => s.trim());
  return segments[segments.length - 1] || null;
}

/** The type a value constructs (`new T()`, `T{}`, `T()`, `T::new()`), or null. */
export function constructedTypeName(value: Node): string | null {
  let node = value;
  for (let depth = 0; depth < 4 && WRAPPER_VALUE.test(node.type); depth++) {
    const inner = node.childForFieldName('operand') ?? node.namedChild(0);
    if (!inner) return null;
    node = inner;
  }
  if (CREATION_VALUE.test(node.type)) {
    const callee = node.childForFieldName('constructor') ?? node.childForFieldName('type') ?? node.namedChild(0);
    return callee ? plainName(callee.text) : null;
  }
  if (LITERAL_VALUE.test(node.type)) {
    const type = node.childForFieldName('type') ?? node.childForFieldName('name');
    return type ? plainName(type.text) : null;
  }
  if (CALL_VALUE.test(node.type)) {
    const callee = node.childForFieldName('function') ?? node.namedChild(0);
    if (!callee) return null;
    if (IDENTIFIER.test(callee.text) || callee.type === 'identifier' || callee.type === 'type_identifier') return plainName(callee.text);
    if (QUALIFIED_CALLEE.test(callee.type)) {
      const member = callee.childForFieldName('name') ?? callee.childForFieldName('attribute') ?? callee.childForFieldName('field') ?? callee.childForFieldName('property');
      if (member?.text !== 'new') return null;
      const qualifier = callee.childForFieldName('path') ?? callee.childForFieldName('object') ?? callee.childForFieldName('operand') ?? callee.namedChild(0);
      return qualifier ? plainName(qualifier.text) : null;
    }
  }
  return null;
}

/**
 * The declarations a node introduces: a parameter, a variable, a field, an
 * assignment. Several for `a, b := x, y` (Go) and `let`-less tuples.
 */
function declarationsOf(node: Node): Declaration[] {
  const type = node.childForFieldName('type');
  const declarator = node.childForFieldName('declarator');
  if (declarator) {
    const name = declarator.childForFieldName('name') ?? declarator.childForFieldName('pattern');
    return name ? [{ name, type, value: declarator.childForFieldName('value') }] : [];
  }
  const left = node.childForFieldName('name') ?? node.childForFieldName('pattern') ?? node.childForFieldName('left');
  const right = node.childForFieldName('value') ?? node.childForFieldName('right');
  if (!left) {
    // Python's `x: T` parameter: the name is the first child, without a field.
    const first = node.firstNamedChild;
    return type && first !== null && first.type === 'identifier' ? [{ name: first, type, value: null }] : [];
  }
  if (left.type === 'expression_list') {
    return left.namedChildren.map((name, i) => {
      const value = right?.type === 'expression_list' ? right.namedChild(i) : right;
      return { name, type: null, value: value ?? null };
    });
  }
  return [{ name: left, type, value: right }];
}

/** The key a declaration is looked up by: a name, or `this.f` / `self.f` for an assignment to a field. */
function keyOf(name: Node): string | null {
  const text = name.text;
  if (IDENTIFIER.test(text) || FIELD_RECEIVER.test(text)) return text;
  return null;
}

/** The types the receivers of one file are declared with, read on the first lookup. */
export class ReceiverTypes {
  /** Scope node id → receiver key → the declared type of each declaration (null: not read). */
  private readonly declared = new Map<number, Map<string, Array<string | null>>>();
  /** Ids of the class-like scopes, where the fields of `this.f` are declared. */
  private readonly classScopes = new Set<number>();
  private built = false;

  /**
   * @param root - the root of the file's tree
   * @param wanted - the receiver keys to read: a receiver name, or `this.f` / `self.f`
   *   together with the field `f` (a class field is declared as `f`)
   */
  constructor(
    private readonly root: Node,
    private readonly wanted: ReadonlySet<string>,
  ) {}

  /** The declared type of the receiver expression `receiver` of a call node `call`, or null. */
  typeOf(receiver: Node, call: Node): string | null {
    if (this.wanted.size === 0) return null;
    this.build();
    const text = receiver.text;
    const field = FIELD_RECEIVER.exec(text);
    if (field) {
      for (let scope: Node | null = call.parent; scope; scope = scope.parent) {
        if (!this.classScopes.has(scope.id)) continue;
        const entries = this.declared.get(scope.id);
        const found = [...(entries?.get(text) ?? []), ...(entries?.get(field[1]) ?? [])];
        if (found.length > 0) return agreed(found);
      }
      return null;
    }
    if (!IDENTIFIER.test(text)) return null;
    for (let scope: Node | null = call.parent; scope; scope = scope.parent) {
      const entries = this.declared.get(scope.id)?.get(text);
      if (entries) return agreed(entries);
    }
    return null;
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    this.visit(this.root, this.root, null);
  }

  /**
   * @param declarator - `node` is the `declarator` of its parent, which already
   *   gave the declaration (a Java `variable_declarator` under its declaration)
   */
  private visit(node: Node, scope: Node, classScope: Node | null, declarator = false): void {
    let inner = scope;
    let innerClass = classScope;
    if (CLASS_SCOPE.test(node.type) && !CLASS_SCOPE_EXCLUDED.test(node.type)) {
      inner = node;
      innerClass = node;
      this.classScopes.add(node.id);
    } else if (FUNCTION_SCOPE.test(node.type) && !FUNCTION_SCOPE_EXCLUDED.test(node.type)) {
      inner = node;
    }
    // A leaf (an identifier, a literal) declares nothing.
    if (node.namedChildCount === 0) return;
    if (!declarator) {
      for (const declaration of declarationsOf(node)) this.record(declaration, inner, innerClass);
    }
    const declaratorChild = node.childForFieldName('declarator');
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) this.visit(child, inner, innerClass, declaratorChild !== null && child.id === declaratorChild.id);
    }
  }

  private record(declaration: Declaration, scope: Node, classScope: Node | null): void {
    const key = keyOf(declaration.name);
    if (key === null || !this.wanted.has(key)) return;
    const owner = FIELD_RECEIVER.test(key) ? classScope : scope;
    if (!owner) return;
    const declared = declaration.type ? declaredTypeName(declaration.type) : null;
    const type = declared ?? (declaration.value ? constructedTypeName(declaration.value) : null);
    let entries = this.declared.get(owner.id);
    if (!entries) {
      entries = new Map();
      this.declared.set(owner.id, entries);
    }
    const list = entries.get(key);
    if (list) list.push(type);
    else entries.set(key, [type]);
  }
}

/** The one type all declarations give, or null when they disagree or one gives none. */
function agreed(types: Array<string | null>): string | null {
  const first = types[0];
  if (first === null || first === undefined) return null;
  return types.every((t) => t === first) ? first : null;
}

/**
 * The receiver keys `typeOf` needs for a receiver expression: its name, or
 * `this.f` / `self.f` with the field name `f`. Null when it has no key.
 */
export function receiverKeys(receiverText: string): string[] | null {
  if (IDENTIFIER.test(receiverText)) return [receiverText];
  const field = FIELD_RECEIVER.exec(receiverText);
  return field ? [receiverText, field[1]] : null;
}
