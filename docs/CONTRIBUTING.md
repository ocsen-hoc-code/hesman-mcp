# Contributing

## Development Setup

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10

### Install

```bash
# Clone the repository
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp

# Install dependencies
npm install

# Download Tree-sitter WASM parsers
npx tsx scripts/download-parsers.ts

# TypeScript check
npx tsc --noEmit
```

### Development Workflow

```bash
# Run the server in development mode (hot reload via tsx)
npm run dev

# Build for production
npm run build

# Run the compiled version
npm start
```

### Code Quality

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format
```

---

## Running Tests

### All Tests

```bash
npm test
```

### Test Variants

```bash
# Watch mode (during development)
npm run test:watch

# Single test file
npx vitest run tests/unit/stores/sqlite.test.ts

# By directory
npx vitest run tests/unit/parsers/

# By name pattern
npx vitest run -t "compact mode"
```

### Performance Benchmarks

```bash
# Run all benchmarks
npm run test:perf

# Single benchmark
npx vitest bench --run tests/perf/indexing.bench.ts
```

Performance thresholds are defined in `tests/perf/thresholds.ts`:

| Benchmark | Target |
|-----------|--------|
| Index throughput | >= 500 files/sec |
| `find_symbol` exact | < 1ms |
| `find_symbol` fuzzy | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |
| Memory after index | < 350MB |

### End-to-End Tests

```bash
npx vitest run tests/e2e/
```

E2E tests start the full MCP server with a mock project and exercise all 11 tools via the MCP Client SDK.

### Integration Tests

Integration tests validate the full pipeline flow:

```bash
npx vitest run tests/integration/
```

- `compression-pipeline.test.ts` — compact → prune → summarize → compress flow
- `graph-pipeline.test.ts` — relations, getCallers/getCallees integration
- `incremental.test.ts` — incremental re-indexing
- `search-pipeline.test.ts` — semantic search via ZVec

---

## Project Structure

```
src/
├── index.ts              # Entry point / CLI dispatcher
├── cli/                  # CLI subcommands (commands.ts, install.ts)
├── config/               # Config loading (schema.ts, loader.ts, defaults.ts)
├── parsers/              # Tree-sitter parsing, compression, language profiles
│   └── profiles/         # Language-specific profiles (typescript.ts, python.ts, go.ts)
├── indexing/             # Index orchestration, worker pool, file watcher
├── stores/               # SQLite and ZVec store implementations
├── server/               # MCP server, tool implementations, response compression
│   └── tools/            # 11 MCP tools
├── monorepo/             # Workspace detection and cross-package indexing
└── diagnostics/          # Metrics collection
```

---

## Adding a Language

Symbols are extracted by a generic engine (`src/parsers/tags-engine.ts`) that runs the language's
Tree-sitter `tags.scm` query. A new language is therefore mostly **data**: a WASM grammar, a query
file, a small profile and one registry entry.

### 1. Add the WASM Grammar

Add the grammar to `parsers/` and pin its URL and sha256 in `scripts/download-parsers.ts`. It must
load in the pinned `web-tree-sitter` (0.25.10: ABI 13–15). Use the upstream release asset, as
decided in [ADR 0001](adr/0001-grammar-distribution.md).

### 2. Vendor the Tags Query

Copy the grammar's own `queries/tags.scm` **at the same revision as the grammar** to
`queries/<lang>/tags.scm`, unmodified. A query is only valid for the grammar revision it was
written for.

- Allowed sources: the grammar's upstream repository, the xberg bundle (MIT) where upstream has
  none, and queries written for Hesman. **Not** Helix (MPL-2.0) or Aider (Apache-2.0) queries.
- Record the file in `queries/SOURCES.json` (repository, tag, commit, SPDX license, sha256) and in
  `NOTICE`. `tests/unit/parsers/queries.test.ts` fails when a query file has no provenance, when an
  upstream file was edited, or when a query does not compile against the committed grammar.
- If upstream misses definitions you need, do not edit its file: add
  `queries/<lang>/hesman-tags.scm` and list it **after** the upstream file. Layers are applied in
  order and the earliest pattern that tags a name wins, so a gap filler adds symbols but never
  changes what upstream tags.

The engine understands the shared convention:

| Capture | Meaning |
|---|---|
| `@definition.<suffix>` | The definition node (its range becomes the symbol's lines) |
| `@reference.<suffix>` | A reference (available from the engine; not stored yet, see M1-07) |
| `@name` | The identifier inside either |

Suffixes map to Hesman kinds in `src/parsers/symbol-kinds.ts` (`function`, `method`, `class`,
`interface`, `type`, `enum`, `constant`, `variable`, `namespace`; `module` → `namespace`,
`struct` → `class`, `trait` → `interface`, `macro` → `function`, …). An unknown suffix becomes the
kind `unknown` — the symbol is still indexed.

Signatures and doc comments need no code: the signature is the first line of the definition
without its body, and the doc comment is the contiguous comment block directly above it.

### 3. Create the Profile

Create `src/parsers/profiles/<language>.ts`:

```typescript
import type { LanguageProfile } from '../language-profile.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const myLangProfile: LanguageProfile = {
  language: 'mylang',
  extensions: ['.my'],

  get parserWasmPath(): string {
    return join(__dirname, '..', '..', '..', 'parsers', 'tree-sitter-mylang.wasm');
  },

  // Optional: the language's own visibility rule (default: inside an `export_statement`).
  isExported: (name, _node) => !name.startsWith('_'),
};
```

Two override hooks exist for what a query cannot express. Use one only with a comment in the
profile that states the reason:

- `extractDocComment(node, source)` — documentation that is not a comment above the definition
  (Python docstrings). Return `null` to fall back to the generic helper.
- `includeDefinition(definition)` — drop a definition an unmodified upstream query tags
  (TypeScript body-less signatures, which would make call resolution ambiguous).

`relationQueries` still marks a language for regex-based relation extraction
(`relation-extractor.ts`); relation queries for more languages are a separate task (M1-07).

### 4. Add One Registry Entry

`src/parsers/languages.ts` is the **single source of truth** for languages. The scanner, index
coordinator, worker threads, file watcher and tools all derive their tables from it — do not add
extension or profile maps anywhere else. Append one entry to `LANGUAGES`:

```typescript
import { myLangProfile } from './profiles/mylang.js';

export const LANGUAGES: readonly LanguageDefinition[] = Object.freeze([
  // ...existing entries
  {
    id: 'mylang',                       // must equal myLangProfile.language
    extensions: ['.my'],                // lowercase, with the leading dot; must equal the profile's list
    grammar: 'tree-sitter-mylang.wasm', // file name inside parsers/; must match parserWasmPath
    tagsQuery: ['mylang/tags.scm', 'mylang/hesman-tags.scm'], // relative to queries/, layered in order
    profile: myLangProfile,
  },
]);
```

The registry validates itself at load time (duplicate ids, an extension claimed by two languages,
or a profile whose `language` differs from the entry id all throw). Consumers use the helpers:
`profileFor(id)`, `languageForPath(path)`, `languageForExtension(ext)`, `languageById(id)`,
`isLanguageId(id)`, `tagsQueryFiles(def)` and `LANGUAGE_IDS`. A language without `tagsQuery` is
parsed but yields no symbols.

### 5. Write Tests

- `tests/unit/parsers/languages.test.ts` checks every entry against its profile and that its
  grammar file exists — update the expected `LANGUAGE_IDS` list.
- `tests/unit/parsers/queries.test.ts` checks the query files of every registered language
  automatically (existence, provenance, compilation).
- Add `tests/unit/parsers/mylang.symbols.test.ts` (symbol extraction) and
  `mylang.relations.test.ts` (calls, imports).
- Add a fixture project in `tests/fixtures/<lang>-basic/` (or a directory in `polyglot-basic`) and
  an e2e assertion that `find_symbol` finds one of its symbols through the real server, which
  indexes via the worker pool.
- If the change alters the symbols of an already supported language, bump `INDEX_SCHEMA_VERSION`
  in `src/stores/sqlite.ts` so existing indexes are rebuilt.

No other code changes are needed: the worker, file watcher, scanner and `get_context` pick the
language up from the registry.

---

## Pull Request Checklist

- [ ] Code compiles: `npm run typecheck`
- [ ] No lint errors: `npm run lint`
- [ ] All tests pass: `npm test`
- [ ] New features include tests (unit + integration)
- [ ] Changes are formatted: `npm run format`
- [ ] New dependencies are justified in PR description
- [ ] Performance benchmarks are not degraded (check `npm run test:perf`)
- [ ] Language changes include a grammar, a tags query with provenance (`queries/SOURCES.json`, `NOTICE`), a profile, symbol/relation tests and a fixture
- [ ] Docs updated: README.md for user-facing changes, docs/ for architecture/tools
- [ ] Changelog updated with user-facing changes
- [ ] No `.hesman/` or `dist/` files committed
- [ ] Commit message follows conventional format (feat/fix/docs/refactor/perf/test/ci)

---

## CI Pipeline

The CI runs on every push and pull request across Ubuntu, macOS, and Windows (Node 20 and 22):

```yaml
steps:
  - npm ci
  - Download WASM parsers
  - Typecheck
  - Lint
  - Build
  - Unit + Integration tests
  - E2E tests
  - Performance benchmarks (Linux + Node 22 only)
```

Performance benchmark failures do not block the build (continue-on-error).

---

## Release Process

1. Update version in `package.json` and `CHANGELOG.md`
2. Create a GitHub release with tag `v<version>`
3. The `publish.yml` workflow automatically publishes to npm
