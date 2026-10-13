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
| Tampered parser binaries | Downloaded Tree-sitter WASM grammars are verified against pinned SHA-256 hashes before being written, and again before they are loaded (see [Grammar downloads](#grammar-downloads)). | `scripts/download-parsers.ts`, `src/parsers/grammar-store.ts` |

## Grammar downloads

Grammars outside the bundled set are fetched at run time, which is the only network access the indexer makes besides the first download of the embedding model. A grammar is WebAssembly that Hesman executes in the `web-tree-sitter` sandbox on the source files of the project, so what may be loaded is fixed in advance:

- **Only pinned files.** `grammars.json`, shipped in the package, lists each grammar with its URL, size and sha256. Hesman never asks a remote service which grammars exist, and requests no URL that is not in that file. Every URL is an HTTPS release asset of the grammar's own GitHub repository; a redirect is followed only to `github.com`, `objects.githubusercontent.com` or `release-assets.githubusercontent.com`, at most three times.
- **Verified before writing and before loading.** A response larger than the pinned size is aborted; the bytes are hashed in memory and written (temporary file, then rename) only if the hash matches. Each time a process loads a grammar it reads the cached file once, hashes those bytes and hands the same bytes to the runtime; a file that no longer matches is deleted and treated as missing. The same check applies to `hesman grammars install --from <directory>`.
- **Failure is not an indexing failure.** Without the grammar (no network, wrong hash, timeout after 60 s) the files are indexed as text. A failed background download is not retried for 10 minutes.
- **Nothing about the project is sent.** The request carries no query string and no project data; the host sees that this machine fetched a given grammar.
- **Off switch.** `HESMAN_GRAMMARS_OFFLINE=1` or `"grammars": { "offline": true }` disables every grammar download, including `hesman grammars install <language>`.
- **Where it is stored.** In the per-user cache (`HESMAN_CACHE_DIR`, `XDG_CACHE_HOME` or the platform's cache directory, under `hesman/grammars/`), never in the project. Anyone who can write to that directory can only cause a grammar to be discarded, not replaced, as long as they cannot also change `grammars.json` in the installation.

Not covered: a grammar that is malicious at the pinned revision. Pins are reviewed when they are added (`scripts/verify-grammar-catalog.ts` loads each one), and the WebAssembly sandbox gives a grammar no file or network access of its own.

## Dashboard (`hesman ui`)

`hesman ui` starts an HTTP server on the user's machine. It is a second way into the same data as the MCP tools, so it gets its own guards. The threats are: another machine on the network, a web page open in the user's browser (cross-site requests, DNS rebinding), and another local user.

| Risk | Guard | Where / test |
|---|---|---|
| Access from the network | The server listens on `127.0.0.1` only; there is no option to bind another address. | `src/ui/server/server.ts`; "listens on 127.0.0.1 only" |
| Use by anything that does not know the URL | A random 256-bit token is generated per start and printed with the URL. Every `/api/*` request needs it as `Authorization: Bearer <token>` or as the `hesman_ui` cookie (`HttpOnly`, `SameSite=Strict`), which is set only when the page is loaded with the right `?token=`. The token is compared in constant time, is not accepted as a query parameter of an API call, and is never written to a file or a log. Without it: `401`. | "answers 401 without a token", "answers 401 for a wrong token", "sets the cookie ... and only then" |
| DNS rebinding | A request whose `Host` header is not exactly `127.0.0.1:<port>` or `localhost:<port>` gets `403`, for the API and for static files. | "answers 403 when Host is ..." |
| Cross-site requests from a web page | A request with an `Origin` header other than this server's own origin gets `403`, even with a valid token. No CORS header is ever sent, so another origin cannot read a response either. Tool calls need `Content-Type: application/json`, which a cross-site form cannot send. | "answers 403 when Origin is ...", "sends no CORS headers", "rejects a body that is not sent as application/json" |
| Reading files outside the UI directory | A static path is decoded once and checked segment by segment (no empty, `.`/`..`, dot-file or `:` segments, no backslash or NUL byte), and the real path of the file must be inside the real path of the UI directory, so symlinks cannot lead out. Directories are never listed. The compiled server code under `dist/ui/server/` is not served. | `src/ui/server/static.ts`; "does not serve anything outside the UI directory", "does not follow a symlink ...", "has no directory listing" |
| Reading files outside the project through a tool | `POST /api/tools/:name` calls `McpServer.callTool`, the same function the MCP `tools/call` handler uses, on handlers registered by the same `registerAllTools`. Argument validation and `resolveProjectPath` confinement are therefore the same code as over MCP. | "validates arguments exactly as the MCP tool does", "keeps file access inside the project" |
| Changing the index or the project | The index is opened with SQLite's read-only flag plus `query_only`; the dashboard has no indexing endpoint and writes no file in the project or the data directory. | `src/ui/server/index-reader.ts`; "never changes the index", "refuses writes through the store ..." |
| Oversized or slow requests | Bodies are limited to 1 MiB (`413`); every numeric query parameter is type-checked and clamped; graph endpoints have node and edge limits and report `truncated`. | "rejects an oversized body", `tests/unit/ui/graph-scale.test.ts` |
| Script injection into the page | Static responses carry `Content-Security-Policy: default-src 'self'` (no inline or remote scripts), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. API responses are JSON with `Cache-Control: no-store`. | "serves index.html at / with security headers" |
| Leaking machine paths | File paths below the project root leave the API project-relative. `/api/status` reports the absolute project root and data directory on purpose. | "makes paths below the project root relative" |

What is stored for the dashboard, by the MCP server, inside the data directory (`.hesman/`):

- `logs/hesman.log` — the server's own log lines. They contain paths, counts, tool names and error messages; never file contents.
- `tool-calls.jsonl` — per tool call: time, tool name, duration, outcome, token counts and a preview of the arguments (strings cut at 80 characters, 300 characters in total). Responses are not stored. An argument can be a search text or a pattern the agent typed, so treat the file like shell history.

Known limits: the token is part of the URL, so it is visible in the terminal, in the browser history and, while the browser is being started, in the process list of the machine (use `--no-open` and paste the URL to avoid the last one). Anyone who can read the user's terminal or files is outside the threat model above. The server speaks plain HTTP, which is why it is bound to the loopback interface only.

## Reporting a vulnerability

Please report vulnerabilities privately through a GitHub security advisory on [ocsen-hoc-code/hesman-mcp](https://github.com/ocsen-hoc-code/hesman-mcp/security/advisories/new) rather than a public issue.
