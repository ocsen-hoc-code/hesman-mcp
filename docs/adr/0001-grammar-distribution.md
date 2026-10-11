# ADR 0001: Grammar source and distribution

- **Status:** Proposed (awaiting approval by the project owner)
- **Date:** 2026-10-11
- **Task:** [M1-01](../../tasks/M1-01-grammar-source-adr.md)
- **Decides for:** M1-02 (tags engine), M1-03 (conformance), M1-05 (grammar delivery), M1-06 (tiers), M1-07 (deep tier)

## 1. Context

Hesman must support **every programming language**, be installable once through Node, and run locally.
Today it ships three WASM grammars committed in `parsers/` (TypeScript, Python, Go; 2,081,625 bytes), loads
them with `web-tree-sitter` `^0.22.6`, and extracts symbols with one hand-written profile per language.

This ADR decides where grammars come from, which ones ship inside the npm package, how the rest reach the
user's machine, and which `web-tree-sitter` version loads them.

### How the numbers were obtained

Everything below was measured on 2026-10-11 on macOS 27.0.1 (Apple M3 Pro), Node v24.5.0, in a scratch
directory outside the repository. Nothing was added to `package.json`. Web sources were accessed on
2026-10-11. The reusable part of the prototype is committed as
[`scripts/experiments/grammar-spike.mjs`](../../scripts/experiments/grammar-spike.mjs); section 9 says how to
re-run it. Where something was *not* measured, the text says so.

## 2. Findings that drive the decision

1. **ABI 15 is already the majority and `web-tree-sitter` 0.22 cannot load it.** Of 104 grammars whose
   upstream repository publishes a `.wasm` on its latest GitHub release, 34 are ABI 14 and 70 are ABI 15.
   `web-tree-sitter` 0.22.6 parses 34 of the 104; the other 70 fail with
   `Incompatible language version 15. Compatibility range 13 through 14.` Versions 0.25.10 and 0.27.1 load
   and parse all 104. Six of the ten prototype languages (C#, Rust, PHP, Swift, Bash, Lua) are ABI 15 in
   their latest upstream release.
2. **The ABI is fixed by the grammar's generated `src/parser.c`, not by the tool that compiles it to WASM.**
   Compiling `tree-sitter-java` v0.23.5 with tree-sitter CLI 0.27.1 gives an ABI 14 module that still loads in
   0.22.6; compiling `tree-sitter-lua` v0.5.0 with the same CLI gives ABI 15. Staying on 0.22 would therefore
   mean pinning old grammar revisions forever, not just "building our own".
3. **The package advertised as "371 precompiled WASM grammars" does not exist in that form.** The WASM npm
   package contains **32** languages linked into one 54 MiB module with its own API. The 306/372-language
   catalog is only available through the *native* (N-API) package, which downloads platform-specific shared
   libraries at runtime and exposes no API for running our own queries.
4. **`tags.scm` coverage is far smaller than grammar coverage.** Of the 372 grammars in the largest catalog,
   65 ship a `queries/tags.scm` upstream at the pinned revision. "Every language parses" is achievable;
   "every language has symbols" is not, without writing queries.
5. **A query is only valid for the exact grammar it was written for.** The Kotlin `tags.scm` written for
   `fwcd/tree-sitter-kotlin` fails to compile against `tree-sitter-grammars/tree-sitter-kotlin` v1.1.0
   (`Bad node name 'type_identifier'`). Grammar and query must be pinned and tested together.
6. **The full catalog is large uncompressed but compresses extremely well.** The 372 native parser libraries
   are 521,047,392 bytes unpacked and 25,788,110 bytes as one zstd archive (macOS arm64). The 104 upstream
   WASM files are 257,409,210 bytes raw and 16,113,823 bytes when gzipped individually (level 9). One grammar
   (`abl`) is 76 MB by itself; the median upstream WASM is 245,604 bytes.

## 3. Measured comparison

| | `@xberg-io/tree-sitter-language-pack-wasm` 1.21.3 (formerly `@kreuzberg/…`) | `@xberg-io/tree-sitter-language-pack` 1.21.3 (native) | `tree-sitter-wasms` 0.1.13 | `@vscode/tree-sitter-wasm` 0.3.1 | `@repomix/tree-sitter-wasms` 0.1.17 | Upstream release `.wasm` assets | Build WASM ourselves (tree-sitter CLI 0.27.1) |
|---|---|---|---|---|---|---|---|
| Languages | 32 (`languageCount()`), despite the "372" description | 372 in the remote manifest; 0 available before a download | 36 `.wasm` files | 16 grammars (+ the runtime) | 17 | 104 of 372 catalog grammars found (lower bound) | Any grammar with a generated `parser.c` |
| Installed size | 57,092,019 B; one 56,824,652 B `.wasm` | 40,257,530 B (8 platform `.node` files, 4.6–5.5 MB each) + downloads | 51,769,841 B | 22,082,102 B | 23,875,389 B | per file: 3,757 B – 76,464,114 B, median 245,604 B | Java 415,233 B, Lua 53,265 B, COBOL 13,664,239 B |
| How grammars arrive | Bundled in the npm tarball, statically linked; no download path (`prefetch` documents "no network step") | Runtime download from GitHub Releases: the **whole** platform bundle (22–26 MB `.tar.zst`) on first use, then per-language `.dylib`/`.so`/`.dll` extracted into a cache | Bundled in npm | Bundled in npm | Bundled in npm | Downloaded by us, URL + sha256 pinned (as `scripts/download-parsers.ts` does today) | Built in our CI, hosted by us |
| Grammar ABI | not exposed | not exposed (native `TSLanguage`) | 13–14 | 14–15 | 14–15 | 34 x ABI 14, 70 x ABI 15 | whatever the pinned `parser.c` declares |
| Loads in `web-tree-sitter` 0.22.6 | n/a (own runtime, own API) | n/a | 9 of 10 prototype languages load; **Swift aborts the Node process** (V8 `Fatal process out of memory: Zone`) | ABI 14 files only | ABI 14 files only | 34 / 104 | ABI 14 grammars only |
| Loads in `web-tree-sitter` 0.27.1 | n/a | n/a | **0** (legacy `dylink` section rejected; also rejected by 0.26.13; still accepted by 0.25.10) | all tested | all tested | 104 / 104 | yes |
| Can run our own `tags.scm` / relation queries | No `Query` API; only its built-in `process()` extraction | No `Query` API; only its built-in `process()` extraction | Yes (via `web-tree-sitter`) | Yes | Yes | Yes | Yes |
| `tags.scm` available | `getTagsQuery()`: not counted per language (Bash returns none) | 69 of 372 bundled | none shipped | none shipped | none shipped | 65 of 372 upstream at the pinned revision | same as upstream |
| License | MIT (package) | MIT (package); grammars 319 MIT, 35 Apache-2.0, 7 ISC, 4 BSD-3-Clause, 4 BSD-2-Clause, 2 Unlicense, 1 CC0-1.0 | Unlicense (package); grammar licenses not included | MIT | Unlicense | per grammar; the 10 prototype grammars are MIT | per grammar |
| Update cadence | 34 versions on npm under the new scope since 2026-06-26 (116 under the old one since 2026-03-16); latest 2026-10-10 | same | last publish 2025-10-07; built with `tree-sitter-cli ^0.20.8`; most grammar packages pinned at `^0.20.x` | last publish 2026-04-07 | last publish 2026-04-22 | per repository (latest releases range from 2024-08 to 2026-10) | ours |
| Other | Node RSS 222 MiB after `require()` | `engines.node >= 22`; scope renamed in June 2026 — `@kreuzberg/*` stopped at 1.10.9 (2026-06-24) and is not marked deprecated | | | | no release asset for 258 of 362 GitHub-hosted grammars | toolchain cache 631 MB (wasi-sdk + binaryen), downloaded by the CLI on first build |

Sources: npm registry metadata (`npm view <package>`), the installed package contents, and
<https://github.com/xberg-io/tree-sitter-language-pack/releases/tag/v1.21.3> (`parsers.json`,
`GRAMMAR_NOTICES-1.21.3.md`, `grammar-provenance-1.21.3.json`, `parser-sources-1.21.3.tar.zst`).

Notes on the numbers:

- "104 of 372" is a lower bound: the probe tried the asset names `tree-sitter-<name>.wasm` for the catalog
  key and the repository suffix (with `-`/`_` variants) on each repository's *latest* release.
- The `tags.scm` count (65) was taken at the revisions pinned in `grammar-provenance-1.21.3.json`.
- Other sources of tags queries, not adopted here: Aider ships 31 + 27 `*-tags.scm` files (Apache-2.0,
  <https://github.com/Aider-AI/aider/tree/main/aider/queries>); Helix ships 77 `tags.scm` files using the same
  `@definition.*` / `@name` convention (MPL-2.0,
  <https://github.com/helix-editor/helix/tree/master/runtime/queries>).

### Prototype: ten languages, upstream release WASM

Small sample file per language (about 300–500 bytes; samples are in the script). One process per grammar.
`parse` is the median of 25 parses after one warm-up. "defs" are distinct `@definition.*` matches that also
captured `@name`.

| Language | Grammar (upstream release) | WASM bytes | ABI | 0.22.6 | 0.27.1 load | 0.27.1 parse | Tags query | Result on 0.27.1 |
|---|---|---:|---:|---|---:|---:|---|---|
| Java | `tree-sitter/tree-sitter-java` v0.23.5 | 414,641 | 14 | OK | 1.5 ms | 0.102 ms | upstream | 5 defs, 5 refs |
| C# | `tree-sitter/tree-sitter-c-sharp` v0.23.5 | 5,350,581 | 15 | **fails (ABI)** | 3.2 ms | 0.141 ms | upstream | 5 defs, 2 refs |
| C++ | `tree-sitter/tree-sitter-cpp` v0.23.4 | 3,434,931 | 14 | OK | 2.8 ms | 0.124 ms | upstream | 6 defs, 0 refs |
| Rust | `tree-sitter/tree-sitter-rust` v0.24.2 | 1,118,099 | 15 | **fails (ABI)** | 1.8 ms | 0.123 ms | upstream | 10 defs, 5 refs |
| PHP | `tree-sitter/tree-sitter-php` v0.25.1 (`php`) | 1,081,285 | 15 | **fails (ABI)** | 1.8 ms | 0.128 ms | upstream | 8 defs, 2 refs |
| Ruby | `tree-sitter/tree-sitter-ruby` v0.23.1 | 2,106,352 | 14 | OK | 2.3 ms | 0.102 ms | upstream | 5 defs, 23 refs |
| Kotlin | `fwcd/tree-sitter-kotlin` 0.3.8 | 4,052,625 | 14 | OK | 3.0 ms | 0.201 ms | from the xberg bundle (none upstream at this tag) | 10 defs, 5 refs |
| Swift | `alex-pinkus/tree-sitter-swift` 0.7.3 | 3,825,025 | 15 | **fails (ABI)** | 3.4 ms | 0.155 ms | upstream | 13 defs, 0 refs |
| Bash | `tree-sitter/tree-sitter-bash` v0.25.1 | 1,358,224 | 15 | **fails (ABI)** | 2.0 ms | 0.073 ms | two-line query written for this spike (none upstream) | 2 defs, 5 refs |
| Lua | `tree-sitter-grammars/tree-sitter-lua` v0.5.0 | 54,603 | 15 | **fails (ABI)** | 1.3 ms | 0.106 ms | upstream | 4 defs, 5 refs |

All ten parse their sample with zero `ERROR`/missing nodes on 0.27.1. On 0.22.6 the four ABI 14 grammars give
the same definitions and references as on 0.27.1 (load 1.2–2.2 ms, parse 0.102–0.194 ms).

Additional observations from the same run:

- `tree-sitter-grammars/tree-sitter-kotlin` v1.1.0 (3,441,042 B, ABI 14) loads, reports one error node on the
  Kotlin sample, and rejects the fwcd-oriented tags query. There are two incompatible Kotlin grammars.
- The three grammars already committed in `parsers/` load and give identical results on 0.22.6 and 0.27.1.
- The upstream TypeScript `tags.scm` alone yields 2 definitions on a sample that has an interface, a class,
  two methods, a type alias and a function. Concatenated with the upstream JavaScript `tags.scm` it yields 5
  (the type alias is still missing). The upstream Go `tags.scm` does not tag constants.
- The TypeScript grammar reports syntax errors on a JSX file; the `tsx` and `javascript` grammars do not.
  The registry currently maps `.tsx`, `.js` and `.jsx` to the TypeScript grammar.

### Building WASM ourselves

- `tree-sitter build --wasm` (CLI 0.27.1) needs no Docker or Emscripten: on first use it downloads wasi-sdk
  and binaryen into `~/.cache/tree-sitter` (631 MB on disk afterwards).
- Build time: Lua 15.3 s including that toolchain download, Java 0.4 s, COBOL 38.3 s; from the xberg
  `parser-sources` bundle: Kotlin 5.2 s, Zig 3.5 s, Dockerfile 0.4 s, Haskell 1.5 s, C# 1.9 s.
- Two consecutive builds of the same source on the same machine produced the same sha256. The result differs
  from the upstream release asset of the same tag (different toolchain), so we cannot verify our builds against
  upstream hashes; we pin our own.
- `parser-sources-1.21.3.tar.zst` (36,989,889 B; 1.9 GB unpacked) contains a generated `src/parser.c` for all
  372 catalog grammars plus 71 `tags.scm` files, with per-grammar repository, revision and SPDX license in
  `grammar-provenance-1.21.3.json`. It has no `grammar.json`; the CLI builds from it once a one-line
  `src/grammar.json` naming the grammar is added.
- **Not measured:** a bulk build of all 372 grammars to WASM (total build time, failures, total size). The spike was stopped before that run finished; M1-05 must measure it before the grammar pack is published.

## 4. Decision

**Keep `web-tree-sitter` and one WASM file per grammar. Upgrade the runtime, bundle a core set, fetch
everything else on demand from a pinned manifest, and fall back to the text tier when a grammar is absent.**

1. **Runtime:** upgrade `web-tree-sitter` from `^0.22.6` to an exact pin of `0.27.1` (ABI 13–15). See
   section 6.
2. **Core set shipped inside the npm package (16 grammars):** TypeScript, TSX, JavaScript, Python, Go, Java,
   C, C++, C#, Rust, PHP, Ruby, Kotlin (`fwcd`), Swift, Bash, Lua. Measured total: **27,387,845 bytes
   unpacked, 2,430,936 bytes gzipped** (the three shipped today are 2,081,625 / 234,349). They are the upstream
   release assets, pinned by URL and sha256 exactly as `scripts/download-parsers.ts` does today.
3. **Everything else is fetched on demand** the first time a project contains files of that language,
   described by a manifest (`grammars.json`) that ships in the npm package. Each entry points either at an
   upstream release asset (104 grammars have one) or at a file in a **Hesman grammar pack** that we build in
   CI with `tree-sitter build --wasm` and publish as GitHub Release assets of the Hesman repository.
4. **`tags.scm` queries are vendored in the npm package** under `queries/<lang>/`, never downloaded. They
   are text (the 71 queries in the largest bundle total 84,315 bytes) and must match the pinned grammar.
5. **No grammar, or no network:** the file is indexed by the text tier (M1-04). Indexing never fails because
   a grammar is missing.

Package-size budget for M1-05: `parsers/` at most **30 MB unpacked**, and the grammars may add at most
**3 MB** to the gzipped tarball. Adding a grammar to the core set must fit in that budget or displace one.

### 4.1 Manifest

`grammars.json` (in the package, generated by a script, reviewed in pull requests):

```json
{
  "abi": { "min": 13, "max": 15 },
  "grammars": {
    "zig": {
      "bundled": false,
      "url": "https://…/tree-sitter-zig.wasm",
      "sha256": "…",
      "bytes": 844409,
      "abi": 14,
      "source": { "repo": "https://github.com/…", "rev": "…", "license": "MIT" },
      "queries": { "tags": "queries/zig/tags.scm" }
    }
  }
}
```

- The sha256 is of the bytes written to the cache (the decompressed `.wasm`). If the transport is compressed,
  it is decompressed in memory, verified, and only then written. A mismatch is never written to disk (M0-10
  code is reused).
- The file is the only place URLs live. Hesman never asks a remote service which grammars exist, so a
  compromised release page cannot make an installed Hesman load an unpinned binary.

### 4.2 Cache location and versioning

```
<cacheRoot>/hesman/grammars/abi-15/<lang>-<first 12 hex of sha256>.wasm
```

- `cacheRoot`: `HESMAN_CACHE_DIR`, else `XDG_CACHE_HOME`, else `~/Library/Caches` (macOS),
  `%LOCALAPPDATA%` (Windows), `~/.cache` (elsewhere). It is per user, shared by all projects, and is not the
  per-project `.hesman/` directory.
- `abi-<max>` is the highest ABI the installed runtime loads. A runtime upgrade that changes the range uses a
  new directory, so old and new Hesman versions can coexist.
- The content hash in the file name lets two Hesman versions that pin different revisions of one grammar share
  the cache without overwriting each other.
- Writes are atomic (temporary file, then rename). A cached file is re-hashed before it is loaded; a file that
  no longer matches is deleted and treated as missing.

### 4.3 Offline story

- Fresh install with no network: the 16 bundled languages work fully; all other files get the text tier, and
  `index_status` lists the languages whose grammar is missing.
- `hesman grammars install <lang…>` and `hesman grammars install --all` pre-fill the cache.
- `hesman grammars install --from <directory>` installs from files copied by hand (air-gapped machines);
  the same sha256 check applies.
- `HESMAN_GRAMMARS_OFFLINE=1` (and a config key) disables all downloads.
- The size of `--all` is not yet known as WASM. The same 372 grammars as native libraries are 521 MB unpacked
  and 25.8 MB zstd-compressed; the WASM total was **not measured** (the bulk build did not finish), so the
  size of `--all` must be measured in M1-05 and stated in the command's help text.

### 4.4 Checksum manifest and update process

1. A maintainer runs `scripts/update-grammars.ts <lang> <new tag or rev>`; it downloads (or triggers the pack
   build), computes sha256, size and ABI, refreshes the vendored query and the license entry, and rewrites
   `grammars.json` and `NOTICE`.
2. The conformance suite (M1-03) must pass for the changed entry: the grammar loads in the pinned runtime, its
   fixture parses, and **every vendored query compiles against that exact grammar**.
3. The change is reviewed as a normal pull request. Grammar updates ship with a Hesman release; there is no
   out-of-band update channel.
4. The grammar pack is published under an immutable tag (for example `grammars-2026.10`). Assets of a
   published tag are never replaced; a rebuilt grammar gets a new tag and a new sha256.

### 4.5 License attribution

- The package gains a generated `NOTICE` file (added to `files` in `package.json`) listing, for every
  bundled grammar and every vendored query: name, repository, revision, SPDX identifier, and the full license
  text once per distinct text.
- The grammar pack release carries the same notice for the grammars it contains, and
  `hesman grammars install` writes it next to the cached files.
- All 372 grammars in the reference catalog carry permissive licenses (319 MIT, 35 Apache-2.0, 7 ISC,
  4 BSD-3-Clause, 4 BSD-2-Clause, 2 Unlicense, 1 CC0-1.0) according to `GRAMMAR_NOTICES-1.21.3.md`; this ADR
  did not audit those texts. The ten prototype grammars were checked directly: nine have an MIT `LICENSE`
  file at the release tag, and Lua (`LICENSE` path not found at the tag) is listed as MIT in the notices.
- A grammar whose license cannot be established is not added to the manifest.

### 4.6 Where `tags.scm` comes from

In order of preference, recorded per language in `NOTICE`:

1. The grammar's own `queries/tags.scm` at the pinned revision, under the grammar's license (65 of 372).
2. A query from the xberg bundle when upstream has none (69 bundled in total; MIT).
3. A query written for Hesman (MIT), stored in the same place. This is also how gaps in upstream queries are
   filled (for example TypeScript type aliases and Go constants, section 3).

Queries may be layered: TypeScript and TSX load the JavaScript query plus their own. Helix (MPL-2.0) and Aider
(Apache-2.0) queries are not used unless the owner decides otherwise (section 8).

A language with a grammar but no tags query gets syntax-aware chunking only; M1-06 must not report it as
"structural".

## 5. Rejected alternatives

- **`@xberg-io/tree-sitter-language-pack-wasm` (formerly `@kreuzberg/…-wasm`).** 32 languages, not 372; one
  56.8 MB module in every install (twice our proposed 16-grammar core); no on-demand path; its own
  parser/tree API with no way to run a query, so neither `tags.scm` (M1-02) nor relation queries (M1-07) could
  run through it; 222 MiB RSS just from loading it.
- **`@xberg-io/tree-sitter-language-pack` (native).** The only candidate that really offers 372 languages
  from one dependency, but: it downloads and `dlopen`s native code at runtime; the first language needed
  pulls the whole 22–26 MB platform bundle; `engines.node >= 22` while Hesman supports Node 20; no query API,
  so symbol extraction would be delegated to its `process()` output and M1-07 would be impossible; the npm
  scope was renamed four months ago with the old scope left un-deprecated, and the project has published 150
  npm versions across both scopes since March 2026. It remains valuable as a **data source**: its pinned
  grammar list, license notices and generated parser sources are what make building our own pack practical.
- **`tree-sitter-wasms`.** 36 grammars built with `tree-sitter-cli ^0.20.8`; none load in `web-tree-sitter`
  0.26 or 0.27; its Swift grammar aborts Node 24.5 under 0.22.6.
- **`@vscode/tree-sitter-wasm` and `@repomix/tree-sitter-wasms`.** Maintained and loadable, but 16 and 17
  grammars chosen for another product's needs; they add a dependency without adding anything over the upstream
  release assets they are built from (the Java and Ruby files in `@vscode` have the same sha256 as the upstream release assets).
- **Bundle every grammar in the npm package.** Hundreds of megabytes unpacked for languages most users never
  open.
- **Stay on `web-tree-sitter` 0.22 and build ABI 14 grammars ourselves.** Possible only by pinning grammar
  revisions older than each grammar's move to ABI 15, which freezes 70 of 104 measured grammars in the past.
- **Download only, bundle nothing.** A fresh offline install would have no symbol extraction at all, and the
  test suite would need the network.

## 6. `web-tree-sitter` upgrade

**Decision: upgrade to `0.27.1`, pinned exactly.** Minor versions of this package have changed both the
public API (0.25) and the accepted module format (0.26), so a caret range is not safe.

| Version | Published | ABI range | Loads the 104 upstream grammars | Loads legacy-`dylink` files | API |
|---|---|---|---|---|---|
| 0.22.6 (current) | 2024-05-05 | 13–14 | 34 | yes | default export `Parser` |
| 0.24.7 | 2025-01-12 | 13–14 | not run on all 104; rejects ABI 15 in the prototype | yes | default export `Parser` |
| 0.25.10 | 2025-09-22 | 13–15 | 104 | yes | named exports |
| 0.26.13 | 2026-08-23 | not read | not run on all 104 (3 grammars tested) | no | named exports |
| 0.27.1 | 2026-10-08 | 13–15 | 104 | no | named exports |

API differences that touch this repository (only four files import the package):

| 0.22.6 | 0.27.1 |
|---|---|
| `import Parser from 'web-tree-sitter'` (CommonJS, default export) | `import { Parser, Language, Query } from 'web-tree-sitter'` (ESM and CJS builds) |
| `Parser.Language.load(path)` | `Language.load(path)` |
| type `Parser.SyntaxNode` | type `Node` |
| `parser.parse()` returns `Tree` | returns `Tree \| null` |
| `language.query(source)` | `new Query(language, source)` |
| `language.version` | `language.abiVersion` |
| files `tree-sitter.js`, `tree-sitter.wasm` | files `web-tree-sitter.js`, `web-tree-sitter.wasm` |

Migration cost, measured: type-checking the current `src/` against the 0.27.1 declarations gives 6 errors in
4 files (`src/parsers/core.ts`, `language-profile.ts`, `profiles/go.ts`, `profiles/python.ts`). A 7-line patch
(new import forms, `Language.load`, a null check after `parse`) brings `tsc --noEmit` back to zero errors. The
three committed grammars give identical results under both versions in the spike.

Not verified by this spike, and therefore part of the upgrade task: the full unit/e2e/perf suites on 0.27.1,
runtime start-up inside worker threads, and behavior on Node 20 (all runs used Node 24.5). The unpacked
dependency grows from 278,790 to 4,687,401 bytes because 0.27.1 also ships a debug build and source maps.

Two existing issues the upgrade task should fix while it is in `core.ts`: a new `Parser` is created for every
file and neither parsers nor trees are ever `delete()`d, so WASM memory is never returned.

## 7. Consequences

- M1-05 has two delivery paths to build (upstream asset, Hesman pack) behind one manifest format.
- We take on a CI job that builds and publishes the grammar pack, and the maintenance of pinned revisions.
- "Every language" is delivered as: 16 languages bundled, a catalog of up to 372 on demand, and the text tier
  for everything else. Symbol extraction beyond the roughly 70 languages that have a tags query requires
  writing queries, which is ongoing work rather than a one-time import.
- The npm tarball grows by about 2.2 MB gzipped and 25.3 MB unpacked.
- Hesman makes outbound HTTPS requests to GitHub at indexing time unless that is disabled.

## 8. Open questions for the project owner

1. **Automatic downloads.** Should the MCP server fetch missing grammars by itself (proposed: yes, in the
   background, with `HESMAN_GRAMMARS_OFFLINE=1` to disable), or only when the user runs
   `hesman grammars install`?
2. **Core set.** Are the 16 proposed grammars the right ones, and is the 30 MB unpacked / 3 MB gzipped budget
   acceptable? C# (5.35 MB), Kotlin (4.05 MB), Swift (3.83 MB) and C++ (3.43 MB) are 61% of the core set.
3. **Hosting.** Is publishing the grammar pack as GitHub Release assets of the Hesman repository acceptable,
   or is a separate repository or mirror wanted?
4. **Build input for the pack.** May the pack build start from xberg's `parser-sources` bundle and provenance
   file (MIT, one download, but ties our catalog to their releases), or should Hesman keep its own list of
   pinned repositories and run `tree-sitter generate` itself (independent, but executes each grammar's
   `grammar.js` in CI and needs 362 repositories fetched)?
5. **Git.** Should the 16 core `.wasm` files (27 MB) be committed, as the current three are, or downloaded by
   `scripts/download-parsers.ts` in CI and at `prepack` and kept out of git?
6. **Runtime version.** Is pinning the three-day-old `0.27.1` acceptable, or is `0.25.10` (also loads all 104,
   one year of patch releases) preferred?
7. **Meaning of "every language".** Is the tier model in section 7 an acceptable reading of the requirement,
   given that only about 70 languages have a tags query today?
8. **Query licenses.** May MPL-2.0 (Helix, 77 queries) or Apache-2.0 (Aider) query files be vendored to widen
   symbol coverage, or should Hesman stay with MIT-compatible upstream and self-written queries?
9. **JSX/TSX.** The registry maps `.tsx`, `.js` and `.jsx` to the TypeScript grammar, which reports errors on
   JSX. Confirm that `tsx` and `javascript` become separate registry entries when the core set lands.
10. **Kotlin grammar.** `fwcd/tree-sitter-kotlin` (parses the sample cleanly, has a usable tags query, last
    release 2024-08) or `tree-sitter-grammars/tree-sitter-kotlin` (newer, one error node on the sample, no
    tags query)?

## 9. Reproducing the measurements

```bash
# in an empty scratch directory, not in this repository
npm init -y
npm i --ignore-scripts wts022@npm:web-tree-sitter@0.22.6 wts027@npm:web-tree-sitter@0.27.1
# download grammar .wasm files and tags.scm files, then describe them in manifest.json:
# [{ "lang": "java", "source": "upstream v0.23.5", "wasm": "/abs/tree-sitter-java.wasm", "tags": "/abs/tags.scm" }]
node <repo>/scripts/experiments/grammar-spike.mjs --runtime node_modules/wts027 --manifest manifest.json
node <repo>/scripts/experiments/grammar-spike.mjs --runtime node_modules/wts022 --manifest manifest.json
```

Use `--filter "<lang> <source>"` to run one grammar per process; the 0.22.6 run needs it because one
third-party Swift build aborts the process. Timings are from one machine and one run each; treat them as
orders of magnitude, not benchmarks.
