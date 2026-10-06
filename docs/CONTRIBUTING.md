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

## Adding a Language Profile

A new language needs exactly four things: a `LanguageProfile`, one entry in the language registry (`src/parsers/languages.ts`), the Tree-sitter WASM grammar, and tests.

### 1. Create the Profile

Create `src/parsers/profiles/<language>.ts`:

```typescript
import type { LanguageProfile } from '../language-profile';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const myLangProfile: LanguageProfile = {
  language: 'mylang',
  extensions: ['.my'],

  get parserWasmPath(): string {
    return join(__dirname, '..', '..', '..', 'parsers', 'tree-sitter-mylang.wasm');
  },

  symbolNodeTypes: new Set([
    'function_definition',
    'class_definition',
  ]),

  relationQueries: {
    calls: `(call_expression function: (identifier) @callee) @call_site`,
    imports: `(import_statement source: (string) @module_path)`,
  },

  extractSignature(nodeText: string, _sourceText: string): string {
    return nodeText.split('\n')[0].trim();
  },

  extractDocComment(nodeStartLine: number, sourceLines: string[]): string | null {
    // Look for comment lines immediately above the symbol
    const line = sourceLines[nodeStartLine - 1]?.trim();
    if (line?.startsWith('//')) return line;
    return null;
  },
};
```

### 2. Download the WASM Parser

Add the WASM file to `parsers/` and update `scripts/download-parsers.ts` if needed.

### 3. Add One Registry Entry

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
    profile: myLangProfile,
  },
]);
```

The registry validates itself at load time (duplicate ids, an extension claimed by two languages,
or a profile whose `language` differs from the entry id all throw). Consumers use the helpers:
`profileFor(id)`, `languageForPath(path)`, `languageForExtension(ext)`, `languageById(id)`,
`isLanguageId(id)` and `LANGUAGE_IDS`.

### 4. Write Tests

- `tests/unit/parsers/languages.test.ts` checks every entry against its profile and that its
  grammar file exists — update the expected `LANGUAGE_IDS` list.
- Add `tests/unit/parsers/mylang.symbols.test.ts` (symbol extraction) and
  `mylang.relations.test.ts` (calls, imports).
- Add a fixture project in `tests/fixtures/<lang>-basic/` (or a directory in `polyglot-basic`) and
  an e2e assertion that `find_symbol` finds one of its symbols through the real server, which
  indexes via the worker pool.

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
- [ ] Language changes include a profile + symbol/relation tests + fixture
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
