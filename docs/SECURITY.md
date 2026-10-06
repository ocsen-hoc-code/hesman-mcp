# Security

## Threat model

Hesman runs locally and is driven by an AI agent over MCP. The agent is **not** a trusted caller: it can be steered by prompt injection hidden in the very code, docs or issues it reads. Every tool argument is therefore treated as untrusted input, and the server must never let a tool reach data or resources outside the indexed project.

Assets protected:
- Files outside the project root (SSH keys, cloud credentials, other projects' `.env` files).
- The availability of the server (one tool call must not freeze all others).
- The user's agent configuration files and the on-disk index.

Out of scope: an attacker who can already run code as the user, or modify the Hesman installation itself.

## Guards in place

| Risk | Guard | Where |
|---|---|---|
| Reading files outside the project | Paths are resolved against the project root and compared by `realpath` (symlinks pointing out are rejected); only regular files under `maxFileSizeBytes` are read; a missing path outside the root reports `PATH_OUTSIDE_PROJECT`, not `FILE_NOT_FOUND`, so tools cannot probe for file existence. | `src/server/paths.ts` |
| Indexing code outside the project | The scanner and the file watcher skip every symlink. | `src/indexing/project-scanner.ts`, `src/indexing/file-watcher.ts` |
| Filter-expression injection into the vector store | `kind` and `language` are validated against fixed enums at the tool and again in the store; other values are quoted with the verified ZVec escaping rules; deletes go by symbol id. | `src/server/tools/semantic-search.ts`, `src/stores/zvec.ts` |
| Regular-expression denial of service | `find_pattern` limits pattern size and placeholders, skips very long lines, and runs the project walk and matching in a worker thread with a 3-second budget. | `src/server/tools/find-pattern*.ts` |
| Oversized or malformed numeric arguments | Numeric arguments are type-checked and clamped (no `LIMIT -1` dumps). | `src/server/args.ts` |
| Corrupting the MCP channel | Logs go to stderr only; stdout carries JSON-RPC exclusively. | `src/utils/logger.ts` |
| Orphan server processes | The server shuts down when stdin closes. | `src/index.ts` |
| Deleting the wrong directory | `hesman clean` refuses the project root, its ancestors, the home directory, filesystem roots, and any non-empty directory without a Hesman `symbols.db`; `--force` does not bypass these checks. | `src/cli/commands.ts` |
| Corrupting agent configuration | `hesman install` writes atomically (temp file + rename) and keeps a `<config>.hesman.bak` backup. | `src/cli/config-writer.ts` |
| Tampered parser binaries | Downloaded Tree-sitter WASM grammars are verified against pinned SHA-256 hashes before being written. | `scripts/download-parsers.ts` |

## Reporting a vulnerability

Please report vulnerabilities privately through a GitHub security advisory on [ocsen-hoc-code/hesman-mcp](https://github.com/ocsen-hoc-code/hesman-mcp/security/advisories/new) rather than a public issue.
