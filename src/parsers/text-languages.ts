/**
 * Language labels of the text tier (M1-04).
 *
 * A file without a grammar in the registry (`languages.ts`) is still indexed
 * as text. This table only gives it a *label* ("ruby", "sql", "dockerfile"),
 * so agents can filter by language; it implies no parser, no symbols and no
 * relations. The grammar registry always wins: this table is consulted only
 * for files `languageForPath` does not know. Languages that do have a grammar
 * are listed too, so a file whose grammar is unavailable (M1-05) still gets
 * its real label when it falls back to the text tier.
 *
 * Provenance: the table was written by hand for Hesman. Where a language is
 * listed in GitHub Linguist's `languages.yml` (MIT License, © GitHub, Inc.,
 * https://github.com/github-linguist/linguist) the label is that language's
 * name, lowercased with spaces and punctuation replaced ("C++" -> "cpp",
 * "Objective-C" -> "objective-c"), and the extensions are a subset of the ones
 * listed there. Nothing else of that file (colors, ids, interpreters, aliases,
 * the long tail of rare extensions) is reproduced.
 *
 * Labels match /^[a-z0-9][a-z0-9+_-]*$/ so they are safe in a ZVec filter.
 */
import { basename, extname } from 'node:path';

/** Label of a text file whose extension and name are not in the table. */
export const TEXT_LANGUAGE_FALLBACK = 'text';

/** label -> extensions (lowercase, with the leading dot). */
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  // --- General-purpose programming languages ---
  abap: ['.abap'],
  actionscript: ['.as'],
  ada: ['.adb', '.ads', '.ada'],
  apex: ['.cls', '.apex', '.trigger'],
  apl: ['.apl', '.dyalog'],
  applescript: ['.applescript', '.scpt'],
  assembly: ['.asm', '.s', '.nasm'],
  autohotkey: ['.ahk'],
  awk: ['.awk', '.gawk'],
  ballerina: ['.bal'],
  basic: ['.bas'],
  batchfile: ['.bat', '.cmd'],
  c: ['.c', '.h'],
  carbon: ['.carbon'],
  clojure: ['.clj', '.cljs', '.cljc', '.edn'],
  cobol: ['.cob', '.cbl', '.cobol', '.cpy', '.ccp'],
  coffeescript: ['.coffee', '.cson'],
  'common-lisp': ['.lisp', '.lsp', '.cl', '.asd'],
  coq: ['.v'],
  cpp: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.ipp', '.tpp', '.inl'],
  crystal: ['.cr'],
  csharp: ['.cs', '.csx'],
  cuda: ['.cu', '.cuh'],
  cython: ['.pyx', '.pxd', '.pxi'],
  d: ['.d', '.di'],
  dart: ['.dart'],
  delphi: ['.dpr', '.dfm'],
  elixir: ['.ex', '.exs'],
  elm: ['.elm'],
  'emacs-lisp': ['.el'],
  erlang: ['.erl', '.hrl'],
  fsharp: ['.fs', '.fsi', '.fsx'],
  go: ['.go'],
  fish: ['.fish'],
  forth: ['.fth', '.4th', '.forth'],
  fortran: ['.f', '.f77', '.f90', '.f95', '.f03', '.f08', '.for'],
  gdscript: ['.gd'],
  gleam: ['.gleam'],
  groovy: ['.groovy', '.gvy', '.gradle'],
  hack: ['.hack'],
  haskell: ['.hs', '.lhs'],
  haxe: ['.hx', '.hxml'],
  idris: ['.idr'],
  java: ['.java'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  julia: ['.jl'],
  kotlin: ['.kt', '.kts'],
  lean: ['.lean'],
  lua: ['.lua'],
  matlab: ['.matlab'],
  mojo: ['.mojo'],
  nim: ['.nim', '.nims', '.nimble'],
  nix: ['.nix'],
  'objective-c': ['.m', '.mm'],
  ocaml: ['.ml', '.mli', '.mll', '.mly'],
  odin: ['.odin'],
  pascal: ['.pas', '.lpr'],
  perl: ['.pl', '.pm', '.t', '.pod'],
  php: ['.php', '.phtml', '.php5', '.phps'],
  powershell: ['.ps1', '.psm1', '.psd1'],
  prolog: ['.pro', '.prolog'],
  purescript: ['.purs'],
  python: ['.py', '.pyw', '.pyi'],
  r: ['.r', '.rmd'],
  racket: ['.rkt'],
  raku: ['.raku', '.rakumod', '.p6'],
  reason: ['.re', '.rei'],
  rescript: ['.res', '.resi'],
  ruby: ['.rb', '.rake', '.gemspec', '.ru', '.erb', '.podspec'],
  rust: ['.rs'],
  sas: ['.sas'],
  scala: ['.scala', '.sc', '.sbt'],
  scheme: ['.scm', '.ss', '.sld'],
  shell: ['.sh', '.bash', '.zsh', '.ksh', '.csh', '.tcsh', '.bats', '.command'],
  smalltalk: ['.st'],
  solidity: ['.sol'],
  'standard-ml': ['.sml', '.sig', '.fun'],
  swift: ['.swift'],
  systemverilog: ['.sv', '.svh'],
  tcl: ['.tcl', '.tk'],
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  vala: ['.vala', '.vapi'],
  vba: ['.vba', '.vbs'],
  verilog: ['.vh'],
  vhdl: ['.vhd', '.vhdl'],
  'vim-script': ['.vim', '.vimrc'],
  'visual-basic': ['.vb'],
  webassembly: ['.wat', '.wast'],
  zig: ['.zig', '.zon'],

  // --- Shading, GPU and hardware ---
  glsl: ['.glsl', '.vert', '.frag', '.geom', '.comp', '.vsh', '.fsh'],
  hlsl: ['.hlsl', '.fx'],
  metal: ['.metal'],
  opencl: ['.opencl'],
  wgsl: ['.wgsl'],

  // --- Query, schema and interface definition ---
  sql: ['.sql', '.ddl', '.dml', '.psql', '.pgsql'],
  plsql: ['.pls', '.plsql', '.pkb', '.pks'],
  tsql: ['.tsql'],
  cypher: ['.cypher', '.cql'],
  sparql: ['.sparql', '.rq'],
  graphql: ['.graphql', '.gql', '.graphqls'],
  prisma: ['.prisma'],
  'protocol-buffer': ['.proto'],
  thrift: ['.thrift'],
  'capn-proto': ['.capnp'],
  avro: ['.avsc', '.avdl'],
  flatbuffers: ['.fbs'],
  smithy: ['.smithy'],
  openqasm: ['.qasm'],

  // --- Web and templates ---
  html: ['.html', '.htm', '.xhtml'],
  css: ['.css'],
  scss: ['.scss'],
  sass: ['.sass'],
  less: ['.less'],
  stylus: ['.styl'],
  vue: ['.vue'],
  svelte: ['.svelte'],
  astro: ['.astro'],
  marko: ['.marko'],
  handlebars: ['.hbs', '.handlebars'],
  mustache: ['.mustache'],
  ejs: ['.ejs'],
  pug: ['.pug', '.jade'],
  haml: ['.haml'],
  slim: ['.slim'],
  liquid: ['.liquid'],
  jinja: ['.jinja', '.jinja2', '.j2'],
  twig: ['.twig'],
  blade: ['.blade'],
  razor: ['.cshtml', '.razor'],
  jsp: ['.jsp', '.jspx', '.tag'],
  'asp-net': ['.aspx', '.ascx', '.asax'],
  freemarker: ['.ftl'],
  velocity: ['.vm'],
  smarty: ['.tpl'],
  'go-template': ['.gotmpl', '.tmpl'],
  mdx: ['.mdx'],

  // --- Configuration, build and infrastructure ---
  json: ['.json', '.jsonc', '.json5', '.webmanifest', '.geojson'],
  jsonnet: ['.jsonnet', '.libsonnet'],
  yaml: ['.yaml', '.yml'],
  toml: ['.toml'],
  ini: ['.ini', '.cfg', '.conf', '.properties', '.editorconfig'],
  xml: ['.xml', '.xsd', '.xsl', '.xslt', '.wsdl', '.plist', '.csproj', '.vbproj', '.fsproj', '.props', '.targets', '.nuspec', '.resx', '.xaml', '.storyboard', '.xib'],
  hcl: ['.hcl', '.tf', '.nomad'],
  bicep: ['.bicep'],
  cmake: ['.cmake'],
  makefile: ['.mk', '.mak'],
  meson: ['.meson'],
  ninja: ['.ninja'],
  starlark: ['.bzl', '.bazel', '.star'],
  dockerfile: ['.dockerfile', '.containerfile'],
  nginx: ['.nginx', '.nginxconf'],
  puppet: ['.pp'],
  cue: ['.cue'],
  dhall: ['.dhall'],
  kdl: ['.kdl'],
  just: ['.just'],
  gn: ['.gn', '.gni'],
  qmake: ['.pri'],
  autoconf: ['.ac', '.m4'],
  systemd: ['.service', '.socket', '.timer', '.mount'],
  'windows-registry': ['.reg'],
  'visual-studio-solution': ['.sln'],
  rego: ['.rego'],
  sentinel: ['.sentinel'],
  robotframework: ['.robot', '.resource'],
  gherkin: ['.feature'],
  http: ['.http', '.rest'],
  diff: ['.diff', '.patch'],
  qml: ['.qml'],
  'linker-script': ['.ld', '.lds'],
  'device-tree': ['.dts', '.dtsi'],
  kconfig: ['.kconfig'],
  llvm: ['.ll'],
  antlr: ['.g4'],
  bison: ['.y', '.yy'],
  lex: ['.l', '.lex'],
  ebnf: ['.ebnf', '.bnf'],

  // --- Documentation and prose formats ---
  markdown: ['.md', '.markdown', '.mdown', '.mkd'],
  restructuredtext: ['.rst'],
  asciidoc: ['.adoc', '.asciidoc'],
  org: ['.org'],
  tex: ['.tex', '.sty', '.bib', '.ltx'],
  typst: ['.typ'],
  textile: ['.textile'],
  roff: ['.man', '.roff', '.1', '.3', '.5', '.8'],
  texinfo: ['.texi', '.texinfo'],
  mermaid: ['.mmd', '.mermaid'],
  plantuml: ['.puml', '.plantuml'],
  graphviz: ['.dot', '.gv'],

  // --- Localisation and plain text ---
  gettext: ['.po', '.pot'],
  [TEXT_LANGUAGE_FALLBACK]: ['.txt', '.text'],
};

/** label -> exact file names (compared lowercase). */
const FILE_NAMES: Readonly<Record<string, readonly string[]>> = {
  dockerfile: ['dockerfile', 'containerfile'],
  makefile: ['makefile', 'gnumakefile', 'bsdmakefile', 'kbuild'],
  cmake: ['cmakelists.txt'],
  ruby: ['gemfile', 'rakefile', 'guardfile', 'podfile', 'vagrantfile', 'fastfile', 'appfile', 'brewfile', 'dangerfile', 'berksfile', 'capfile'],
  groovy: ['jenkinsfile'],
  starlark: ['build', 'build.bazel', 'workspace', 'workspace.bazel', 'module.bazel', 'tiltfile', 'buck'],
  just: ['justfile'],
  meson: ['meson.build', 'meson_options.txt'],
  'go-module': ['go.mod', 'go.work'],
  shell: ['gradlew', 'mvnw', 'pkgbuild', 'apkbuild'],
  ini: ['procfile', 'codeowners', 'pipfile'],
  nginx: ['nginx.conf'],
  caddyfile: ['caddyfile'],
  kconfig: ['kconfig'],
  earthfile: ['earthfile'],
};

/** File-name prefixes that carry a label whatever follows ("Dockerfile.prod"). */
const NAME_PREFIXES: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ['dockerfile.', 'dockerfile'],
  ['containerfile.', 'dockerfile'],
  ['makefile.', 'makefile'],
  ['jenkinsfile.', 'groovy'],
];

const BY_EXTENSION = new Map<string, string>();
const BY_NAME = new Map<string, string>();
const LABELS = new Set<string>([TEXT_LANGUAGE_FALLBACK]);

for (const [label, extensions] of Object.entries(EXTENSIONS)) {
  LABELS.add(label);
  for (const ext of extensions) {
    // First entry wins: ambiguous extensions are listed under the commoner language.
    if (!BY_EXTENSION.has(ext)) BY_EXTENSION.set(ext, label);
  }
}
for (const [label, names] of Object.entries(FILE_NAMES)) {
  LABELS.add(label);
  for (const name of names) {
    if (!BY_NAME.has(name)) BY_NAME.set(name, label);
  }
}
for (const [, label] of NAME_PREFIXES) LABELS.add(label);

/** Every label this module can return, sorted. Always contains `text`. */
export const TEXT_LANGUAGE_LABELS: readonly string[] = Object.freeze([...LABELS].sort());

/** True if `label` is one of the text-tier language labels. */
export function isTextLanguageLabel(label: string): boolean {
  return LABELS.has(label);
}

/**
 * The text-tier label of a file, from its name and extension only. Never
 * `undefined`: an unknown file is labelled `text`. Whether the file should be
 * indexed at all is decided elsewhere (`indexing/text-file-filter.ts`).
 */
export function textLanguageForPath(filePath: string): string {
  const name = basename(filePath).toLowerCase();
  const byName = BY_NAME.get(name);
  if (byName) return byName;
  for (const [prefix, label] of NAME_PREFIXES) {
    if (name.startsWith(prefix)) return label;
  }
  const ext = extname(name);
  return (ext && BY_EXTENSION.get(ext)) || TEXT_LANGUAGE_FALLBACK;
}
