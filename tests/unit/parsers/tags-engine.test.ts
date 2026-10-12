import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Parser, Language, type Tree } from 'web-tree-sitter';
import { kindForTagSuffix, UNKNOWN_KIND } from '../../../src/parsers/symbol-kinds';
import {
  TagsQuery,
  splitPatterns,
  signatureOf,
  docCommentAbove,
  MAX_SIGNATURE_LENGTH,
} from '../../../src/parsers/tags-engine';
import { tsProfile } from '../../../src/parsers/profiles/typescript';
import { pythonProfile } from '../../../src/parsers/profiles/python';
import { goProfile } from '../../../src/parsers/profiles/go';

/**
 * The engine is exercised with small inline queries against the three committed
 * grammars, so it is tested independently of the vendored `queries/` files.
 */
describe('tags engine', () => {
  const languages: Record<string, Language> = {};
  const parsers: Record<string, Parser> = {};
  const trees: Tree[] = [];

  beforeAll(async () => {
    await Parser.init();
    for (const profile of [tsProfile, pythonProfile, goProfile]) {
      const language = await Language.load(profile.parserWasmPath);
      const parser = new Parser();
      parser.setLanguage(language);
      languages[profile.language] = language;
      parsers[profile.language] = parser;
    }
  });

  afterAll(() => {
    for (const tree of trees) tree.delete();
    for (const parser of Object.values(parsers)) parser.delete();
  });

  function parse(language: string, source: string): Tree {
    const tree = parsers[language].parse(source);
    if (!tree) throw new Error('no tree');
    trees.push(tree);
    return tree;
  }

  describe('kindForTagSuffix', () => {
    it.each([
      ['function', 'function'],
      ['method', 'method'],
      ['class', 'class'],
      ['interface', 'interface'],
      ['type', 'type'],
      ['enum', 'enum'],
      ['constant', 'constant'],
      ['variable', 'variable'],
      ['namespace', 'namespace'],
      ['module', 'namespace'],
      ['struct', 'class'],
      ['trait', 'interface'],
      ['macro', 'function'],
      ['field', 'variable'],
    ])('maps @definition.%s to %s', (suffix, kind) => {
      expect(kindForTagSuffix(suffix)).toBe(kind);
    });

    it('maps an unknown suffix to the generic kind instead of dropping it', () => {
      expect(kindForTagSuffix('widget')).toBe(UNKNOWN_KIND);
      expect(kindForTagSuffix('')).toBe(UNKNOWN_KIND);
    });

    it('is not fooled by Object.prototype members', () => {
      expect(kindForTagSuffix('constructor')).toBe('method');
      expect(kindForTagSuffix('toString')).toBe(UNKNOWN_KIND);
    });
  });

  describe('splitPatterns', () => {
    it('splits top-level patterns and keeps trailing captures with their pattern', () => {
      const source = [
        '; a comment with (parens',
        '(function_declaration name: (identifier) @name) @definition.function',
        '',
        '(type_identifier) @name @reference.type',
        '((comment)* @doc . (class_declaration name: (_) @name) @definition.class',
        '  (#match? @name "^[A-Z(]"))',
        '[(a) (b)] @definition.x',
      ].join('\n');
      const patterns = splitPatterns(source);
      expect(patterns).toHaveLength(4);
      expect(patterns[0]).toContain('@definition.function');
      expect(patterns[1].trim()).toBe('(type_identifier) @name @reference.type');
      expect(patterns[2]).toContain('"^[A-Z(]"');
      expect(patterns[3].trim()).toBe('[(a) (b)] @definition.x');
    });

    it('returns no patterns for an empty or comment-only source', () => {
      expect(splitPatterns('')).toEqual([]);
      expect(splitPatterns('; nothing here\n')).toEqual([]);
    });
  });

  describe('definitions', () => {
    it('extracts @definition.<suffix> captures with their @name, in document order', () => {
      const query = new TagsQuery(languages.python, [
        {
          name: 'inline',
          source: `
            (class_definition name: (identifier) @name) @definition.class
            (function_definition name: (identifier) @name) @definition.function
          `,
        },
      ]);
      const tree = parse('python', 'def a():\n    pass\n\nclass B:\n    def c(self):\n        pass\n');
      const defs = query.definitions(tree.rootNode);
      expect(defs.map((d) => [d.name, d.suffix, d.kind, d.node.startPosition.row])).toEqual([
        ['a', 'function', 'function', 0],
        ['B', 'class', 'class', 3],
        ['c', 'function', 'function', 4],
      ]);
      expect(defs[1].node.type).toBe('class_definition');
      expect(defs[1].nameNode.type).toBe('identifier');
      query.delete();
    });

    it('keeps a definition whose suffix is unknown, with the generic kind', () => {
      const query = new TagsQuery(languages.go, [
        { name: 'inline', source: '(package_clause (package_identifier) @name) @definition.package_thing' },
      ]);
      const tree = parse('go', 'package demo\n');
      const defs = query.definitions(tree.rootNode);
      expect(defs.map((d) => [d.name, d.suffix, d.kind])).toEqual([['demo', 'package_thing', UNKNOWN_KIND]]);
      query.delete();
    });

    it('ignores patterns that capture @name without a @definition (upstream Go does this)', () => {
      const query = new TagsQuery(languages.go, [
        {
          name: 'inline',
          source: `
            (const_declaration (const_spec name: (identifier) @name))
            (function_declaration name: (identifier) @name) @definition.function
          `,
        },
      ]);
      const tree = parse('go', 'package demo\nconst Limit = 1\nfunc F() {}\n');
      expect(query.definitions(tree.rootNode).map((d) => d.name)).toEqual(['F']);
      query.delete();
    });

    it('layers queries: a later layer adds definitions the earlier one misses', () => {
      const base = { name: 'upstream', source: '(function_declaration name: (identifier) @name) @definition.function' };
      const gap = { name: 'hesman', source: '(const_spec name: (identifier) @name) @definition.constant' };
      const source = 'package demo\nconst Limit = 1\nfunc F() {}\n';

      const alone = new TagsQuery(languages.go, [base]);
      expect(alone.definitions(parse('go', source).rootNode).map((d) => d.name)).toEqual(['F']);

      const layered = new TagsQuery(languages.go, [base, gap]);
      expect(layered.definitions(parse('go', source).rootNode).map((d) => [d.name, d.kind, d.layer])).toEqual([
        ['Limit', 'constant', 'hesman'],
        ['F', 'function', 'upstream'],
      ]);
      alone.delete();
      layered.delete();
    });

    it('reports one definition per name: the earliest layer wins, so a gap filler never overrides upstream', () => {
      const upstream = {
        name: 'upstream',
        source: `(variable_declarator name: (identifier) @name value: (arrow_function)) @definition.function`,
      };
      const gap = { name: 'hesman', source: '(variable_declarator name: (identifier) @name) @definition.variable' };
      const query = new TagsQuery(languages.typescript, [upstream, gap]);
      const tree = parse('typescript', 'const f = () => 1;\nconst x = 2;\n');
      expect(query.definitions(tree.rootNode).map((d) => [d.name, d.kind, d.layer])).toEqual([
        ['f', 'function', 'upstream'],
        ['x', 'variable', 'hesman'],
      ]);
      query.delete();
    });

    it('applies standard text predicates and tolerates unknown directives', () => {
      const query = new TagsQuery(languages.typescript, [
        {
          name: 'inline',
          source: `
            ((comment)* @doc .
              (method_definition name: (property_identifier) @name) @definition.method
              (#not-eq? @name "constructor")
              (#strip! @doc "^[\\\\s\\\\*/]+|^[\\\\s\\\\*/]$")
              (#select-adjacent! @doc @definition.method))
          `,
        },
      ]);
      const tree = parse('typescript', 'class A {\n  constructor() {}\n  // one\n  // two\n  run() {}\n}\n');
      expect(query.definitions(tree.rootNode).map((d) => d.name)).toEqual(['run']);
      query.delete();
    });

    it('orders an outer definition before the definitions it contains', () => {
      const query = new TagsQuery(languages.typescript, [
        {
          name: 'inline',
          source: `
            (method_definition name: (_) @name) @definition.method
            (class_declaration name: (_) @name) @definition.class
          `,
        },
      ]);
      const tree = parse('typescript', 'class A { m() {} }\n');
      expect(query.definitions(tree.rootNode).map((d) => d.name)).toEqual(['A', 'm']);
      query.delete();
    });

    it('compiles each query once and reuses it across trees', () => {
      const query = new TagsQuery(languages.python, [
        { name: 'inline', source: '(function_definition name: (identifier) @name) @definition.function' },
      ]);
      for (let i = 0; i < 3; i++) {
        const tree = parse('python', `def f${i}():\n    pass\n`);
        expect(query.definitions(tree.rootNode).map((d) => d.name)).toEqual([`f${i}`]);
      }
      query.delete();
    });

    it('names the offending layer when a query does not compile for the grammar', () => {
      expect(
        () =>
          new TagsQuery(languages.go, [
            { name: 'good.scm', source: '(function_declaration name: (identifier) @name) @definition.function' },
            { name: 'bad.scm', source: '(no_such_node name: (identifier) @name) @definition.function' },
          ]),
      ).toThrow(/bad\.scm/);
    });
  });

  describe('references', () => {
    const SOURCE = `
      (function_definition name: (identifier) @name) @definition.function
      (call function: [(identifier) @name (attribute attribute: (identifier) @name)]) @reference.call
      (class_definition superclasses: (argument_list (identifier) @name @reference.class))
    `;

    it('extracts @reference.<suffix> captures with 1-based lines', () => {
      const query = new TagsQuery(languages.python, [{ name: 'inline', source: SOURCE }]);
      const tree = parse('python', 'class B(A):\n    pass\n\ndef f():\n    g()\n    x.h(1)\n');
      expect(query.references(tree.rootNode)).toEqual([
        { name: 'A', suffix: 'class', line: 1, col: 8 },
        { name: 'g', suffix: 'call', line: 5, col: 4 },
        { name: 'h', suffix: 'call', line: 6, col: 6 },
      ]);
      query.delete();
    });

    it('does not report references from definitions() or definitions from references()', () => {
      const query = new TagsQuery(languages.python, [{ name: 'inline', source: SOURCE }]);
      const tree = parse('python', 'def f():\n    g()\n');
      expect(query.definitions(tree.rootNode).map((d) => d.name)).toEqual(['f']);
      expect(query.references(tree.rootNode).map((r) => r.name)).toEqual(['g']);
      query.delete();
    });

    it('does not report the name of a definition as a reference to itself', () => {
      const query = new TagsQuery(languages.go, [
        {
          name: 'inline',
          source: `
            (type_spec name: (type_identifier) @name) @definition.type
            (type_identifier) @name @reference.type
          `,
        },
      ]);
      const tree = parse('go', 'package demo\ntype A int\ntype B A\n');
      // `A` on line 2 and `B` on line 3 are definition names, not references.
      expect(query.references(tree.rootNode)).toEqual([
        { name: 'int', suffix: 'type', line: 2, col: 7 },
        { name: 'A', suffix: 'type', line: 3, col: 7 },
      ]);
      query.delete();
    });
  });

  describe('signatureOf', () => {
    const cases: Array<[string, string, string, string]> = [
      ['typescript', 'export function add(a: number, b: number): number {\n  return a + b;\n}\n', 'function_declaration', 'function add(a: number, b: number): number'],
      ['typescript', 'function one(o: { a: number }): number { return o.a; }\n', 'function_declaration', 'function one(o: { a: number }): number'],
      ['typescript', 'export type Status = "a" | "b";\n', 'type_alias_declaration', 'type Status = "a" | "b";'],
      ['typescript', 'const john: Person = {\n  name: "J",\n};\n', 'variable_declarator', 'john: Person ='],
      ['python', 'class AdminUser(User):\n    pass\n', 'class_definition', 'class AdminUser(User)'],
      ['python', 'def add(a: int, b: int) -> int:\n    return a + b\n', 'function_definition', 'def add(a: int, b: int) -> int'],
      ['go', 'package demo\nfunc (s *Server) Start() string {\n\treturn ""\n}\n', 'method_declaration', 'func (s *Server) Start() string'],
      ['go', 'package demo\ntype Circle struct {\n\tRadius float64\n}\n', 'type_spec', 'Circle struct'],
    ];

    it.each(cases)('%s: %s', (language, source, nodeType, expected) => {
      const tree = parse(language, source);
      const node = tree.rootNode.descendantsOfType(nodeType)[0];
      expect(node).toBeTruthy();
      expect(signatureOf(node!, source)).toBe(expected);
    });

    it('caps the length', () => {
      const source = `function long(${'a: number, '.repeat(60)}z: number): void {}\n`;
      const tree = parse('typescript', source);
      const node = tree.rootNode.descendantsOfType('function_declaration')[0]!;
      const signature = signatureOf(node, source);
      expect(signature.length).toBe(MAX_SIGNATURE_LENGTH);
      expect(signature.startsWith('function long(a: number,')).toBe(true);
    });
  });

  describe('docCommentAbove', () => {
    function docOf(language: string, source: string, nodeType: string, index = 0): string | null {
      const tree = parse(language, source);
      const node = tree.rootNode.descendantsOfType(nodeType)[index];
      expect(node).toBeTruthy();
      return docCommentAbove(node!, source);
    }

    it('reads a block comment above an exported declaration', () => {
      expect(docOf('typescript', '/** Adds two numbers */\nexport function add() {}\n', 'function_declaration')).toBe(
        'Adds two numbers',
      );
    });

    it('reads a multi-line block comment', () => {
      const source = '/**\n * A person.\n *\n * With a name.\n */\nexport interface Person {}\n';
      expect(docOf('typescript', source, 'interface_declaration')).toBe('A person.\n\nWith a name.');
    });

    it('joins contiguous line comments', () => {
      const source = 'package demo\n\n// Start starts the server.\n// It blocks.\nfunc Start() {}\n';
      expect(docOf('go', source, 'function_declaration')).toBe('Start starts the server.\nIt blocks.');
    });

    it('reads the comment above a declaration wrapper (Go type_spec inside type_declaration)', () => {
      const source = 'package demo\n\n// Circle is a shape.\ntype Circle struct {}\n';
      expect(docOf('go', source, 'type_spec')).toBe('Circle is a shape.');
    });

    it('reads hash comments', () => {
      expect(docOf('python', '# Adds.\ndef add():\n    pass\n', 'function_definition')).toBe('Adds.');
    });

    it('returns null when a blank line separates the comment from the definition', () => {
      expect(docOf('go', 'package demo\n\n// stray\n\nfunc F() {}\n', 'function_declaration')).toBeNull();
    });

    it('returns null without a comment', () => {
      expect(docOf('go', 'package demo\n\nfunc F() {}\n', 'function_declaration')).toBeNull();
    });

    it('does not take the trailing comment of the previous statement', () => {
      expect(docOf('go', 'package demo\n\nvar x = 1 // trailing\nfunc F() {}\n', 'function_declaration')).toBeNull();
    });

    it('does not give the first comment to a later declarator of the same statement', () => {
      const source = '// about a\nconst a = 1, b = 2;\n';
      expect(docOf('typescript', source, 'variable_declarator', 0)).toBe('about a');
      expect(docOf('typescript', source, 'variable_declarator', 1)).toBeNull();
    });

    it('documents a method from the comment inside the class body', () => {
      const source = 'class A {\n  /** Runs. */\n  run() {}\n}\n';
      expect(docOf('typescript', source, 'method_definition')).toBe('Runs.');
    });
  });
  describe('TagsQuery.relations and TagsQuery.analyze (M1-07)', () => {
    const LAYER = {
      name: 'inline',
      source: [
        '(function_declaration name: (identifier) @name) @definition.function',
        '(call_expression function: (identifier) @name) @reference.call',
        '(call_expression function: (member_expression property: (property_identifier) @name)) @reference.send',
        '(import_statement source: (string (string_fragment) @name)) @reference.import',
        '(type_annotation (type_identifier) @name) @reference.type',
      ].join('\n'),
    };
    const SOURCE = [
      "import { b } from './b.js';",
      'function a(x: Thing): number {',
      "  // c(1) 'd(2)'",
      '  return b(x) + x.e();',
      '}',
    ].join('\n');

    it('reports calls (`@reference.call`, `@reference.send`) at the callee name, in document order', () => {
      const query = new TagsQuery(languages.typescript, [LAYER]);
      const { calls } = query.relations(parse('typescript', SOURCE).rootNode);
      // Line 4: `  return b(x) + x.e();` — `b` at column 9, `e` at column 18.
      // Both are made by `function a` (line 2); `e` is called on `x` (M1-09).
      const caller = { name: 'a', kind: 'function', line: 2 };
      expect(calls).toEqual([
        { name: 'b', line: 4, col: 9, caller },
        { name: 'e', line: 4, col: 18, caller, receiver: 'x' },
      ]);
      query.delete();
    });

    it('reports imports with the line of the statement and the specifier without quotes', () => {
      const query = new TagsQuery(languages.typescript, [LAYER]);
      const { imports } = query.relations(parse('typescript', SOURCE).rootNode);
      expect(imports).toEqual([{ specifier: './b.js', line: 1, col: 19 }]);
      query.delete();
    });

    it('does not report other references, nor the name of a definition', () => {
      const query = new TagsQuery(languages.typescript, [
        LAYER,
        // A broad pattern that also matches the name in `function a(`.
        { name: 'broad', source: '((identifier) @name @reference.call (#eq? @name "a"))' },
      ]);
      const { calls } = query.relations(parse('typescript', `${SOURCE}\nfunction f() { a(1); }`).rootNode);
      expect(calls.map((c) => `${c.name}@${c.line}`)).toEqual(['b@4', 'e@4', 'a@6']);
      query.delete();
    });

    it('skips a pattern with a property predicate, which the runtime cannot evaluate', () => {
      const query = new TagsQuery(languages.typescript, [
        LAYER,
        { name: 'locals', source: '((identifier) @name @reference.call (#is-not? local))' },
      ]);
      const { calls } = query.relations(parse('typescript', SOURCE).rootNode);
      expect(calls.map((c) => c.name)).toEqual(['b', 'e']);
      query.delete();
    });

    it('analyze() returns the same definitions and relations as the two separate calls', () => {
      const query = new TagsQuery(languages.typescript, [LAYER]);
      const root = parse('typescript', SOURCE).rootNode;
      const both = query.analyze(root);
      expect(both.definitions.map((d) => `${d.kind} ${d.name}`)).toEqual(['function a']);
      expect(both.definitions.map((d) => d.name)).toEqual(query.definitions(root).map((d) => d.name));
      expect(both.references).toEqual(query.relations(root));
      query.delete();
    });

    it('a language without relation patterns has no relations', () => {
      const query = new TagsQuery(languages.typescript, [
        { name: 'defs', source: '(function_declaration name: (identifier) @name) @definition.function' },
      ]);
      const root = parse('typescript', SOURCE).rootNode;
      expect(query.relations(root)).toEqual({ calls: [], imports: [] });
      expect(query.analyze(root).references).toEqual({ calls: [], imports: [] });
      query.delete();
    });
  });
});
