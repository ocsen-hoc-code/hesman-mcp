/**
 * The on-demand grammar catalog (M1-05, ADR 0001 sections 4.1 and 10).
 *
 * Each entry is the `.wasm` asset of the grammar's own upstream GitHub release,
 * downloaded once, loaded in the pinned `web-tree-sitter` (which gave `abi`)
 * and pinned here by URL, size and sha256. Nothing is built by Hesman and no
 * third-party bundle is used. `scripts/generate-grammar-manifest.ts` turns
 * this table and the bundled set (`PARSERS`) into `grammars.json`.
 *
 * An entry with `tags` has the grammar's own `queries/tags.scm` at the same
 * revision vendored under `queries/<id>/` (recorded in `queries/SOURCES.json`
 * and `NOTICE`): its files are parsed for symbols once the grammar is cached.
 * An entry without `tags` yields no symbols, so its files stay on the text
 * tier and the grammar is never downloaded automatically; it is pinned so
 * `hesman grammars install` can fetch a verified copy for later use.
 *
 * `id` is the text-tier label of the language (`src/parsers/text-languages.ts`).
 */
export interface OnDemandGrammarSpec {
  id: string;
  /** Name of the release asset. */
  file: string;
  repo: string;
  /** Release tag. */
  rev: string;
  /** Commit the tag points at. */
  commit: string;
  /** SPDX identifier of the grammar's license at that tag. */
  license: string;
  sha256: string;
  bytes: number;
  abi: number;
  /** Extensions parsed with this grammar (only with `tags`). */
  extensions?: readonly string[];
  /** The vendored upstream tags query, as a path under `queries/`. */
  tags?: string;
}

/** The URL of a release asset: the only form of URL the manifest may contain. */
export function releaseAssetUrl(spec: Pick<OnDemandGrammarSpec, 'repo' | 'rev' | 'file'>): string {
  return `${spec.repo}/releases/download/${encodeURIComponent(spec.rev)}/${spec.file}`;
}

export const ON_DEMAND_GRAMMARS: readonly OnDemandGrammarSpec[] = [
  {
    id: 'scala',
    file: 'tree-sitter-scala.wasm',
    repo: 'https://github.com/tree-sitter/tree-sitter-scala',
    rev: 'v0.26.2',
    commit: 'b931fcc338390925eb893d70ad070033f5856ccf',
    license: 'MIT',
    sha256: '37d7fe5a91ca98941dc05493b0c05a0df0f36df5035890fa00b02497c68aaac3',
    bytes: 3973559,
    abi: 15,
    extensions: ['.scala', '.sc', '.sbt'],
    tags: 'scala/tags.scm',
  },
  {
    id: 'ocaml',
    file: 'tree-sitter-ocaml.wasm',
    repo: 'https://github.com/tree-sitter/tree-sitter-ocaml',
    rev: 'v0.26.0',
    commit: 'e3c9cf368f68bffd2f81188229aefa7b434eda65',
    license: 'MIT',
    sha256: 'bfa3eef92b9d3cc1117aa486d46ecb06c98a3a28c1747660aaa5851df5e4530c',
    bytes: 4808294,
    abi: 15,
    extensions: ['.ml'],
    tags: 'ocaml/tags.scm',
  },
  {
    id: 'fsharp',
    file: 'tree-sitter-fsharp.wasm',
    repo: 'https://github.com/ionide/tree-sitter-fsharp',
    rev: '0.3.12',
    commit: 'aefd0c8741bdf3aeb827a228aa4a996a6536697e',
    license: 'MIT',
    sha256: 'ff1a927387fec25e184d120d9e18ec7cd5271b30f6380f02d494d3548a99f7b7',
    bytes: 11430318,
    abi: 15,
    extensions: ['.fs', '.fsx'],
    tags: 'fsharp/tags.scm',
  },
  {
    id: 'r',
    file: 'tree-sitter-r.wasm',
    repo: 'https://github.com/r-lib/tree-sitter-r',
    rev: 'v1.3.0',
    commit: '346d3707b8c9301f1051e8f6e32666e67529f7d2',
    license: 'MIT',
    sha256: '3e406e27cec05a60ba3281e2da021187200b83d152d9eb0dcf0a731cbfbcc28d',
    bytes: 487039,
    abi: 14,
    extensions: ['.r'],
    tags: 'r/tags.scm',
  },
  {
    id: 'codeql',
    file: 'tree-sitter-ql.wasm',
    repo: 'https://github.com/tree-sitter/tree-sitter-ql',
    rev: 'v0.23.1',
    commit: '1fd627a4e8bff8c24c11987474bd33112bead857',
    license: 'MIT',
    sha256: 'f7f01c27f942a76ffceb30cb194fe669f81a21971126a57d9bf876bdaffa85dc',
    bytes: 312209,
    abi: 14,
    extensions: ['.ql', '.qll'],
    tags: 'codeql/tags.scm',
  },
  {
    id: 'arduino',
    file: 'tree-sitter-arduino.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-arduino',
    rev: 'v0.24.0',
    commit: '2f0c1223c50aa4b754136db544204c6fc99ffc77',
    license: 'MIT',
    sha256: '905a6e00a8c6baa9a2159a6a92f844a9baba8eebad5601ab7da8a2ee9713725c',
    bytes: 3504674,
    abi: 15,
    extensions: ['.ino'],
    tags: 'arduino/tags.scm',
  },
  {
    id: 'haskell',
    file: 'tree-sitter-haskell.wasm',
    repo: 'https://github.com/tree-sitter/tree-sitter-haskell',
    rev: 'v0.24.1',
    commit: '97288e585b0bd44199720280d067fa35bacd81ff',
    license: 'MIT',
    sha256: 'ea89cb1199b1ca2102e273b27239e795baff17248128a9bcd3c3825ac17d8cc0',
    bytes: 3840677,
    abi: 15,
  },
  {
    id: 'elixir',
    file: 'tree-sitter-elixir.wasm',
    repo: 'https://github.com/elixir-lang/tree-sitter-elixir',
    rev: 'v0.3.5',
    commit: 'e2d9e6e0e76b0c436fa48a0b8c32a031d0cbdf49',
    license: 'Apache-2.0',
    sha256: '1818ae0d7343f880abb0b7932c9a815f09896ca67b3e126096a2dd7677d1477b',
    bytes: 1436984,
    abi: 14,
  },
  {
    id: 'zig',
    file: 'tree-sitter-zig.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-zig',
    rev: 'v1.1.2',
    commit: 'b670c8df85a1568f498aa5c8cae42f51a90473c0',
    license: 'MIT',
    sha256: '54b3b83dd9c62da5815f06132bc3fc914d9dcc780370b32416446a0b7969e8c6',
    bytes: 691726,
    abi: 14,
  },
  {
    id: 'julia',
    file: 'tree-sitter-julia.wasm',
    repo: 'https://github.com/tree-sitter/tree-sitter-julia',
    rev: 'v0.25.0',
    commit: 'e0f9dcd180fdcfcfa8d79a3531e11d99e79321d3',
    license: 'MIT',
    sha256: 'b20da9dc7d7334e2cae034ca4974dd09c94be8c0a524df1fc194b545bc2f49f5',
    bytes: 2636367,
    abi: 15,
  },
  {
    id: 'perl',
    file: 'tree-sitter-perl.wasm',
    repo: 'https://github.com/tree-sitter-perl/tree-sitter-perl',
    rev: 'v2.0.0',
    commit: '50904961d6a87c5191e611276aa2ecb9d66ca4ff',
    license: 'MIT',
    sha256: '7d4ad86813db08e2edc69b42d18d7a6c52a0770cba61365b7932f7d6b56ee36f',
    bytes: 4739417,
    abi: 15,
  },
  {
    id: 'objective-c',
    file: 'tree-sitter-objc.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-objc',
    rev: 'v3.0.2',
    commit: '18802acf31d0b5c1c1d50bdbc9eb0e1636cab9ed',
    license: 'MIT',
    sha256: '155bf61fc94941fa9d07c86cd46895f14dfb2549fb7f646faeb83765af05c970',
    bytes: 5317155,
    abi: 14,
  },
  {
    id: 'odin',
    file: 'tree-sitter-odin.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-odin',
    rev: 'v1.3.0',
    commit: 'e8adc739b78409a99f8c31313f0bb54cc538cf73',
    license: 'MIT',
    sha256: '4a3c9f50ac2356d2284d26e92322c554b276ad6bf6bce87a8594cff95d2ed6f1',
    bytes: 2215305,
    abi: 14,
  },
  {
    id: 'luau',
    file: 'tree-sitter-luau.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-luau',
    rev: 'v1.2.0',
    commit: 'a8914d6c1fc5131f8e1c13f769fa704c9f5eb02f',
    license: 'MIT',
    sha256: 'f1647052518f2bdfae8e8c0b033ffdeca1193d69d11c78ba20f84c8374fd0fe3',
    bytes: 94204,
    abi: 14,
  },
  {
    id: 'starlark',
    file: 'tree-sitter-starlark.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-starlark',
    rev: 'v1.3.0',
    commit: 'a453dbf3ba433db0e5ec621a38a7e59d72e4dc69',
    license: 'MIT',
    sha256: 'fbc8daea386fbd963b198e7942d9a020b8c74d4d875d1c075af540f2b6b3278d',
    bytes: 329934,
    abi: 14,
  },
  {
    id: 'html',
    file: 'tree-sitter-html.wasm',
    repo: 'https://github.com/tree-sitter/tree-sitter-html',
    rev: 'v0.23.2',
    commit: '5a5ca8551a179998360b4a4ca2c0f366a35acc03',
    license: 'MIT',
    sha256: 'c48fcd82c7ea8bf943180088ba7f28c48b2bb5287874179168bf9d31e394cf85',
    bytes: 18385,
    abi: 14,
  },
  {
    id: 'css',
    file: 'tree-sitter-css.wasm',
    repo: 'https://github.com/tree-sitter/tree-sitter-css',
    rev: 'v0.25.0',
    commit: 'dda5cfc5722c429eaba1c910ca32c2c0c5bb1a3f',
    license: 'MIT',
    sha256: '8a23977fe271357cce6f254ef88c9bebf3854602d8046605aef6a45c02135c59',
    bytes: 128668,
    abi: 15,
  },
  {
    id: 'json',
    file: 'tree-sitter-json.wasm',
    repo: 'https://github.com/tree-sitter/tree-sitter-json',
    rev: 'v0.24.8',
    commit: 'ee35a6ebefcef0c5c416c0d1ccec7370cfca5a24',
    license: 'MIT',
    sha256: 'd2119fb98d5912719b13f9458574f8608d2d29dfbe45f6be1f860ea1fe2a2405',
    bytes: 5596,
    abi: 14,
  },
  {
    id: 'yaml',
    file: 'tree-sitter-yaml.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-yaml',
    rev: 'v0.7.2',
    commit: '7708026449bed86239b1cd5bce6e3c34dbca6415',
    license: 'MIT',
    sha256: '0a0e5ebcfeb0b2bf272d071396eeed107b2c4b2617b69d5959b13f78b357a4d6',
    bytes: 189197,
    abi: 14,
  },
  {
    id: 'toml',
    file: 'tree-sitter-toml.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-toml',
    rev: 'v0.7.0',
    commit: '64b56832c2cffe41758f28e05c756a3a98d16f41',
    license: 'MIT',
    sha256: '1ac6a83826c35a68857f8325e00c78f6bcbef4eb6db3931a6cf3041f76e5e09f',
    bytes: 24040,
    abi: 14,
  },
  {
    id: 'xml',
    file: 'tree-sitter-xml.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-xml',
    rev: 'v0.7.0',
    commit: '4b64dd3a03ec002258d6268d712fd93716d6ab57',
    license: 'MIT',
    sha256: '9950327f8542a3d563fe4192aa05986a53e6fd6adca518cbb1a1699cbc8970ad',
    bytes: 47032,
    abi: 14,
  },
  {
    id: 'markdown',
    file: 'tree-sitter-markdown.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-markdown',
    rev: 'v0.5.3',
    commit: 'f969cd3ae3f9fbd4e43205431d0ae286014c05b5',
    license: 'MIT',
    sha256: 'dd9fc12ac2804d7c7da787e4774125b32e4fb3c244e5e7031a77cb7dd8036020',
    bytes: 421574,
    abi: 15,
  },
  {
    id: 'hcl',
    file: 'tree-sitter-hcl.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-hcl',
    rev: 'v1.2.0',
    commit: 'fad991865fee927dd1de5e172fb3f08ac674d914',
    license: 'Apache-2.0',
    sha256: '2f9acf63e7c263215f283e2cf0f4ebbb9bfa77f58e18fa42b91094be201372a7',
    bytes: 93854,
    abi: 15,
  },
  {
    id: 'makefile',
    file: 'tree-sitter-make.wasm',
    repo: 'https://github.com/tree-sitter-grammars/tree-sitter-make',
    rev: 'v1.1.1',
    commit: '5e9e8f8ff3387b0edcaa90f46ddf3629f4cfeb1d',
    license: 'MIT',
    sha256: '1254d1e5787be8bb944d55d1f6552b6b2b7908272ed498013bfdc07bd7d042dd',
    bytes: 147061,
    abi: 14,
  },
];
