/**
 * Export and binding rules shared by every ECMAScript-family grammar
 * (TypeScript, TSX, JavaScript). They only look at node types and fields these
 * grammars have in common, so one profile per grammar can reuse them; they are
 * also the default of `parseFile` for a profile without an `isExported` hook.
 */
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';

/** Nodes that only wrap a declaration: the declaration is exported iff the wrapper is. */
const DECLARATION_WRAPPERS = new Set(['lexical_declaration', 'variable_declaration', 'ambient_declaration']);
const NAMESPACE_TYPES = new Set(['internal_module', 'module']);
const NON_PUBLIC = new Set(['private', 'protected']);

/** Local names a file exports by reference, per syntax tree (dropped with the tree). */
const exportedNamesCache = new WeakMap<Tree, Set<string>>();

/** True for `module.exports`. */
function isModuleExports(node: SyntaxNode | null): boolean {
  return (
    node?.type === 'member_expression' &&
    node.childForFieldName('object')?.text === 'module' &&
    node.childForFieldName('property')?.text === 'exports'
  );
}

/** True for `module.exports.<name>` and `exports.<name>`. */
function isExportsMember(node: SyntaxNode | null): boolean {
  if (node?.type !== 'member_expression') return false;
  const object = node.childForFieldName('object');
  return (object?.type === 'identifier' && object.text === 'exports') || isModuleExports(object);
}

/** True if `statement` is a statement of the file itself, not of a function or block. */
function isTopLevel(statement: SyntaxNode | null): boolean {
  return statement?.parent?.type === 'program';
}

/**
 * Names of top-level declarations that are exported somewhere else than at the
 * declaration: `export { a, b as c }`, `export default a`,
 * `module.exports = a`, `module.exports = { a, key: b }`, `exports.key = a`.
 */
function exportedNames(tree: Tree): Set<string> {
  let names = exportedNamesCache.get(tree);
  if (names) return names;
  names = new Set<string>();
  exportedNamesCache.set(tree, names);

  for (const statement of tree.rootNode.namedChildren) {
    if (!statement) continue;
    if (statement.type === 'export_statement') {
      // `export { a } from './b.js'` re-exports another module's binding.
      if (statement.childForFieldName('source')) continue;
      const value = statement.childForFieldName('value');
      if (value?.type === 'identifier') names.add(value.text);
      for (const clause of statement.namedChildren) {
        if (clause?.type !== 'export_clause') continue;
        for (const specifier of clause.namedChildren) {
          const local = specifier?.childForFieldName('name');
          if (local) names.add(local.text);
        }
      }
    } else if (statement.type === 'expression_statement') {
      const assignment = statement.firstNamedChild;
      if (assignment?.type !== 'assignment_expression') continue;
      const left = assignment.childForFieldName('left');
      const right = assignment.childForFieldName('right');
      if (!right) continue;
      if (right.type === 'identifier') {
        if (isModuleExports(left) || isExportsMember(left)) names.add(right.text);
      } else if (right.type === 'object' && isModuleExports(left)) {
        for (const entry of right.namedChildren) {
          if (entry?.type === 'shorthand_property_identifier') names.add(entry.text);
          else if (entry?.type === 'pair') {
            const value = entry.childForFieldName('value');
            if (value?.type === 'identifier') names.add(value.text);
          }
        }
      }
    }
  }
  return names;
}

/** True for a `private`, `protected` or `#private` class member. */
function isNonPublicMember(member: SyntaxNode): boolean {
  if (member.childForFieldName('name')?.type === 'private_property_identifier') return true;
  for (const child of member.children) {
    if (child?.type === 'accessibility_modifier') return NON_PUBLIC.has(child.text);
  }
  return false;
}

/**
 * Whether a definition is visible outside its module:
 * - a top-level declaration that is exported (`export` on the declaration, an
 *   export list, `export default name`, or CommonJS `module.exports` / `exports`);
 * - an `export` inside an exported namespace;
 * - a public member of an exported class.
 * Anything declared inside a function body, an object literal that is not
 * `module.exports`, or any other expression is local, whatever encloses it.
 * @param name - the symbol's identifier
 * @param node - the definition node
 */
export function isEcmaScriptExported(name: string, node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;

  switch (parent.type) {
    case 'program':
      return exportedNames(node.tree).has(name);

    case 'export_statement': {
      const scope = parent.parent;
      if (scope?.type === 'program') return true;
      // `namespace A { export function f() {} }`: as visible as the namespace.
      const namespace = scope?.type === 'statement_block' ? scope.parent : null;
      if (!namespace || !NAMESPACE_TYPES.has(namespace.type)) return false;
      return isEcmaScriptExported(namespace.childForFieldName('name')?.text ?? '', namespace);
    }

    case 'class_body': {
      if (isNonPublicMember(node)) return false;
      const owner = parent.parent;
      const ownerName = owner?.childForFieldName('name');
      return owner != null && ownerName != null && isEcmaScriptExported(ownerName.text, owner);
    }

    case 'expression_statement': {
      if (node.type !== 'assignment_expression') return isEcmaScriptExported(name, parent);
      if (!isTopLevel(parent)) return false;
      // `exports.a = function () {}` defines and exports `a`; `a = function () {}` only defines it.
      const left = node.childForFieldName('left');
      return left?.type === 'member_expression' ? isExportsMember(left) : exportedNames(node.tree).has(name);
    }

    case 'object': {
      // A key of `module.exports = { key: function () {} }`.
      const assignment = parent.parent;
      return (
        assignment?.type === 'assignment_expression' &&
        isModuleExports(assignment.childForFieldName('left')) &&
        assignment.parent?.type === 'expression_statement' &&
        isTopLevel(assignment.parent)
      );
    }

    default:
      return DECLARATION_WRAPPERS.has(parent.type) ? isEcmaScriptExported(name, parent) : false;
  }
}

/**
 * True for a function that is only reachable through an object: the value of
 * an object key (`{ onClick: () => ... }`) or assigned to a property
 * (`obj.handler = function () { ... }`). A bare call `onClick()` in another
 * file cannot target it, so the call resolver links it in its own file only.
 */
export function isPropertyAssigned(node: SyntaxNode): boolean {
  if (node.type === 'pair') return true;
  return node.type === 'assignment_expression' && node.childForFieldName('left')?.type === 'member_expression';
}
