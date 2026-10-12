# Hesman CLI

`hesman` without a subcommand runs the MCP server on stdio. This page covers the subcommands that connect it to AI clients (`setup`, `remove`, `doctor`), the local dashboard (`ui`) and the grammar cache (`grammars`). `hesman --help` lists the others (`index`, `status`, `clean`, `diag`).

Supported clients and their `--client` names: `claude-code`, `claude-desktop`, `codex`, `cursor`, `antigravity`, `vscode`, `gemini-cli`, `windsurf`. Accepted short names: `gemini` (gemini-cli), `copilot` and `code` (vscode), `codex-cli` (codex). `claude` is rejected as ambiguous.

## `hesman setup`

Adds the `hesman` server entry to client configs. With no option on a terminal it shows a checklist of the detected clients; without a terminal it prints what it found and exits with 1 instead of waiting for input.

| Flag | Meaning |
|---|---|
| `--client <name…>` | Configure these clients. Names may be separated by spaces or commas, and the flag may be repeated. |
| `--all` | Configure every supported client. |
| `--yes`, `-y` | No questions: configure the detected clients. |
| `--dry-run` | Print the exact change per client; write nothing and run nothing. |
| `--scope user\|project` | `user` (default): the per-user config. `project`: a config file inside the current directory. Clients without that scope are skipped. |
| `--project-root <path>` | The project for clients without a workspace (Claude Desktop). Default: the current directory. |
| `--command auto\|npx\|global\|absolute` | What the clients run. `npx`: `npx -y hesman-mcp@<major>`. `global`: `hesman`. `absolute`: the running Node binary plus this installation's `dist/index.js`. `auto` (default) picks one from how Hesman was started, and gives desktop apps the absolute form when they could not find the command. |

Exit code: 0 when every chosen client was handled, 1 when one failed, nothing was chosen, or an option is invalid.

## `hesman remove`

Takes the `hesman` entry out again. Without `--client` or `--all` it removes it from every client that has one in the chosen scope.

| Flag | Meaning |
|---|---|
| `--client <name…>` | Remove from these clients. |
| `--all` | Remove from every supported client. |
| `--scope user\|project` | Which config to edit; default `user`. |
| `--dry-run` | Print what would be removed; write nothing. |

`--command` is rejected: it only applies to `setup`.

## `hesman doctor`

Checks this installation and the `hesman` entry of each client, end to end, and prints a fix for everything that is wrong. **Doctor never changes anything**: it prints the fix (usually a `hesman setup` command) and applies none.

```bash
hesman doctor                       # every detected client
hesman doctor --client cursor codex # only these
hesman doctor --json                # one JSON object, for scripts and bug reports
```

| Flag | Meaning |
|---|---|
| `--client <name…>` | Check these clients instead of the detected ones. A named client that is not configured is a failure; a merely detected one is a warning. |
| `--json` | Print one JSON object (below) instead of text. |
| `--timeout <ms>` | Limit for the server's `initialize` answer. Default 5000. |

Exit code: **0** when every check passed or only warned, **1** when at least one check failed or an option is invalid.

Doctor examines the **user-scope** config of each client. Project-scope files (`.cursor/mcp.json`, `.mcp.json`, …) are not examined.

### Installation checks

| Check `id` | Passes when | Fix printed on failure |
|---|---|---|
| `entry-script` | this installation's `dist/index.js` exists | `npm run build` in a source checkout, otherwise reinstall |
| `node` | the running Node satisfies `engines.node` of `package.json` (warns when the range is not of the form `>=x.y.z`) | switch Node, then run `hesman setup` again |
| `parsers` | every grammar of the language registry is in `parsers/` | `npx tsx scripts/download-parsers.ts` in a source checkout, otherwise reinstall |

### Client checks

Always reported in this order. A check that cannot run because an earlier one failed has the status `skip`.

| Check `id` | What it verifies | Statuses |
|---|---|---|
| `config` | The config file exists, parses, and has a `hesman` entry with a `command`. | `fail`: unparseable file, entry without `command`, or not configured for a client named with `--client`. `warn`: not configured for a client that was only detected. |
| `entry` | The entry equals what `hesman setup --client <id>` would write now. A `--project-root` already in the entry is kept in the comparison, because setup tells users to add one by hand for some clients. | `warn` when it differs (stale absolute paths after a Node switch or a moved checkout, another launch command, a leftover `cwd`). Never `fail`: whether the entry *works* is decided by the next checks. `details`: `configured`, `expected`, `leftoverCwd`. |
| `command` | The command resolves where the client looks for it. Absolute entries: the binary and the entry script exist. Bare commands: on PATH; for desktop apps on macOS/Linux also inside the standard system directories. `npx` entries: the package is on the npm registry (see below). | `fail`: missing file, not on PATH, registry answered 404. `warn`: a desktop app may not find it; the registry could not be reached. |
| `handshake` | Starting the configured command yields an MCP `initialize` answer within the timeout. | `fail`: could not spawn, exited first (exit code and last stderr lines are quoted), or no answer in time. `details`: `ms`, `timeoutMs`, `server`. |
| `stdout` | Every stdout line of that run was a JSON-RPC message. | `fail` with the first offending line. `details.lines`: up to five of them. |
| `project` | Which project the server would index. | See "What doctor can and cannot know". `details`: `source` (`explicit`, `working directory` or `none`), `root`, `testedFrom`. |

How the server is started: doctor spawns the configured command with `--no-semantic --no-watch` appended and `HESMAN_DATA_DIR` pointing at a temporary directory that is removed afterwards. No index is written into your project and no embedding model is loaded. It sends `initialize` without the `roots` capability, then one `index_status` call, then stops the process. The working directory is the `cwd` of the entry when it has one, otherwise the directory doctor was run from. `env` values of the entry are not applied.

`npx` entries and the network: when Hesman itself was not started through `npx`, doctor asks `https://registry.npmjs.org/<package>` once, with a 2-second limit. A 404 is a failure (`hesman-mcp` was not published as of 2026-10-11); no answer (offline, proxy) is only a warning. Nothing else in doctor uses the network — except the configured command itself when it is `npx`.

### What doctor can and cannot know

- It **can** report an explicit root (`--project-root` in the entry) and whether that directory exists, and what the server does when started from one directory with no roots: the project found from the working directory, or `NO_PROJECT`.
- It **cannot** observe the workspace folders (MCP roots) or the working directory a real client gives the server. Roots take precedence over the working directory, so `NO_PROJECT` here is a warning, not a failure — except for Claude Desktop, which has no workspace: an entry without `--project-root` (and without `cwd`) fails.
- It starts the command with the PATH of the terminal doctor runs in. A desktop app opened from the Dock or a launcher may see a shorter PATH; the `command` check warns about that case but cannot test it.
- A variable such as `${workspaceFolder}` in `--project-root` is expanded by the client only; doctor leaves the argument out when starting the server and warns.
- For **Cursor**, **Antigravity** and **Windsurf** it is unverified how the client tells the server which project is open. Doctor says so for these clients and tells you what to do after restarting them: call a Hesman tool, and on `NO_PROJECT` pin the project (`hesman setup --client cursor --scope project` inside the project, or `"--project-root", "/path/to/project"` in the args of the entry).

These limits are printed per client as `not verifiable:` lines and returned in `unverifiable`.

### `--json` output

One object on stdout:

```jsonc
{
  "version": "1.0.0",            // the Hesman that ran doctor
  "ok": false,                   // false when any check failed (exit code 1)
  "summary": { "pass": 7, "warn": 1, "fail": 1, "skip": 2 },
  "server": {
    "checks": [
      { "id": "entry-script", "status": "pass", "message": "The server entry script exists: /…/dist/index.js" },
      { "id": "node", "status": "pass", "message": "Node 22.3.0 satisfies the required >=20.0.0.", "details": { "version": "22.3.0", "required": ">=20.0.0" } },
      { "id": "parsers", "status": "pass", "message": "All 3 bundled parsers are present in /…/parsers." }
    ]
  },
  "clients": [
    {
      "id": "cursor",
      "label": "Cursor",
      "kind": "gui",              // "gui": desktop app, "cli": terminal client
      "detected": true,
      "configPath": "/home/me/.cursor/mcp.json",
      "configured": { "command": "hesman", "args": [] },   // null when there is no usable entry
      "expected": { "command": "/usr/bin/node", "args": ["/…/dist/index.js"] },   // what setup would write now; null with "configured"
      "status": "fail",           // worst of the checks: "pass" | "warn" | "fail"
      "checks": [
        { "id": "config", "status": "pass", "message": "…" },
        { "id": "entry", "status": "warn", "message": "…", "fix": "hesman setup --client cursor",
          "details": { "configured": "hesman", "expected": "/usr/bin/node /…/dist/index.js", "leftoverCwd": false } },
        { "id": "command", "status": "fail", "message": "`hesman` is not on PATH, so the client cannot start it.", "fix": "hesman setup --client cursor" },
        { "id": "handshake", "status": "skip", "message": "Not checked: the configured command cannot be started." },
        { "id": "stdout", "status": "skip", "message": "Not checked: the configured command cannot be started." },
        { "id": "project", "status": "skip", "message": "Not checked: the server was not started." }
      ],
      "unverifiable": ["Doctor cannot see the workspace folders (MCP roots) or …"]
    }
  ]
}
```

Every check has `id`, `status` (`pass`, `warn`, `fail`, `skip`) and `message`; `fix` and `details` are present only when there is something to say. A client that is not configured has `configured: null`, `expected: null` and one `config` check followed by five `skip` checks. The types are `DoctorReport`, `ClientReport` and `Check` in `src/cli/doctor/types.ts`.

## `hesman ui`

Starts a local dashboard server for one project and prints its URL. It serves a JSON API (logs, tool-call metrics, the symbol graph, a tool playground) and the web page that uses it.

```bash
hesman ui                 # the project in the current directory, a free port, opens the browser
hesman ui path/to/project # another project
hesman ui --port 4100     # a fixed port
hesman ui --no-open       # only print the URL
```

| Flag | Meaning |
|---|---|
| `[path]` | Project root. Default: `projectRoot` from the config, else the current directory. |
| `--port <n>` | Port on `127.0.0.1`. Default `0`: the system picks a free one. A port in use is an error. |
| `--no-open` | Do not start the browser. |
| `--data-dir <dir>` | Data directory, as for the server (also `HESMAN_DATA_DIR`). It must be the one the MCP server uses. |

The project needs an index: run `hesman index` or start the MCP server once. Without one the command exits with code 1 and writes nothing. Stop it with Ctrl+C.

The URL has the form `http://127.0.0.1:<port>/?token=<random>`. The token changes on every start; `/api/*` answers `401` without it. See "Dashboard" in [SECURITY.md](./SECURITY.md) for the access rules.

### Next to a running MCP server

`hesman ui` is a separate process. It opens the SQLite index read-only, so it works while an MCP server for the same project is running and sees what that server commits. It reads two files the MCP server writes into the data directory:

| File | Content | Size bound |
|---|---|---|
| `logs/hesman.log` (or the `logFile` setting; a relative path resolves against the project root) | The server's log lines as JSON, the same lines it writes to stderr. | 5 MB, then renamed to `hesman.log.1` (one rotated file, so at most 10 MB) |
| `tool-calls.jsonl` | One JSON line per tool call: `id`, `time`, `tool`, `durationMs`, `ok`, `errorCode`, `originalTokens`, `compressedTokens`, `argsPreview`. | 2 MB, then renamed to `tool-calls.jsonl.1` (about 20,000 calls in total) |

If you set `logFile`, put it outside the project or inside the data directory, so the file watcher does not see it change.

Not available in the dashboard process, and reported under `limitations` by `GET /api/status`:

- `semantic_search`: the vector store can be open in one process only and the MCP server holds its lock. The tool is not listed by `GET /api/tools`, and `POST /api/tools/semantic_search` answers `409 TOOL_UNAVAILABLE`.
- Live indexing progress: it is kept in the memory of the MCP server. `index.indexing.inProgress` is always `false` here; the counts are what is committed so far.
- Anything that writes: there is no endpoint to index or to change files.

Tool calls made from the dashboard are not added to `tool-calls.jsonl`; the metrics show what agents did through the MCP server.

### API

All responses are JSON: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message" } }`. File paths are project-relative with `/`; line numbers are 1-based. Numeric parameters that are not numbers answer `400 INVALID_INPUT`; out-of-range values are clamped.

| Method and path | Parameters (default, range) | `data` |
|---|---|---|
| `GET /api/status` | | `version`, `projectRoot`, `dataDir`, `serverTime`, `index` (the `index_status` payload; each `languages[]` entry also carries `tier`: `deep` or `structural`), `limitations[] { feature, reason }` |
| `GET /api/metrics` | `windowMinutes` (60, 1–10080) | `summary`, `byTool[]`, `series[]` (at most 61 equal buckets, oldest first) |
| `GET /api/calls` | `limit` (50, 1–500), `before` (a `nextBefore`), `tool` | `calls[]` newest first, `nextBefore` |
| `GET /api/logs` | `level` (minimum level, `info`), `q`, `limit` (200, 1–1000), `before` (a `nextBefore`) | `entries[]` newest first, `nextBefore` |
| `GET /api/graph/search` | `q` (part of the name, case-insensitive), `kind`, `language`, `limit` (30, 1–200) | `symbols[]`: exact names first, then prefixes |
| `GET /api/graph/neighborhood` | `symbolId` (required), `depth` (1, 1–3), `limit` (80, 1–500 nodes) | `center`, `nodes[]`, `edges[]`, `truncated` |
| `GET /api/graph/files` | `limit` (200, 1–1000 files) | `nodes[]` (files with the most symbols first), `edges[]`, `truncated` |
| `GET /api/tools` | | `tools[] { name, description, inputSchema }` |
| `POST /api/tools/:name` | body `{ "args": { ... } }` as `application/json`, at most 1 MiB | `result` (the tool's JSON, including `_meta`), `isError`, `durationMs` |

A tool error is a `200` with `isError: true` and the tool's `error` object in `result`, exactly as over MCP. HTTP errors use the codes `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` and `SYMBOL_NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `TOOL_UNAVAILABLE` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `INVALID_INPUT` (400) and `INTERNAL_ERROR` (500).

## `hesman grammars`

Hesman ships 16 Tree-sitter grammars in the package. Other grammars are downloaded on demand into a per-user cache; this command shows the state of all of them and fills the cache by hand. The server does the same download by itself, in the background, when a project contains files of an on-demand language — `hesman grammars install` is for preparing a machine in advance or for machines without network access.

```
hesman grammars list [--json]
hesman grammars install <language…>
hesman grammars install --all
hesman grammars install --from <directory> [language…]
```

| Command | What it does |
|---|---|
| `list` | One line per grammar: language, state (`bundled`, `cached`, `available`), size, ABI, whether it gives symbols or leaves its files on the text tier, source repository, tag and license. Then the totals and the cache directory. `hesman grammars` alone is the same. |
| `list --json` | The same as one JSON object (below). |
| `install <language…>` | Downloads the named grammars from the URLs pinned in `grammars.json`. A language that is not in the catalog is rejected before anything is downloaded. |
| `install --all` | Prints how many grammars are missing and the total download size first, then downloads every on-demand grammar. The whole catalog is 24 grammars, 46.9 MB (46,893,269 bytes). |
| `install --from <directory> [language…]` | Installs from `.wasm` files in a directory, without the network (it also works in offline mode). A file is recognised by its release name (`tree-sitter-scala.wasm`) or its cache name (`scala-37d7fe5a91ca.wasm`), so the cache directory of another machine can be copied as it is. Without languages, every catalog grammar found in the directory is installed. |

Rules that hold for every path into the cache:

- **Pinned.** A grammar is identified by URL, size and sha256 in `grammars.json`, which ships in the package. Hesman never asks a remote service which grammars exist and never contacts a URL that is not in that file.
- **Verified twice.** The bytes are hashed before they are written (temporary file, then rename) and the cached file is hashed again before it is loaded. A file that does not match is deleted and counts as missing.
- **Cache location.** `HESMAN_CACHE_DIR`, else `XDG_CACHE_HOME` (absolute paths only), else `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows and `~/.cache` elsewhere; under it `hesman/grammars/abi-15/<language>-<first 12 hex of sha256>.wasm`. `abi-15` is the highest grammar ABI the bundled runtime loads. A `NOTICE.txt` next to the files names the repository, tag and license of each cached grammar.
- **Offline mode.** With `HESMAN_GRAMMARS_OFFLINE=1` (or `true`), or `"grammars": { "offline": true }` in `hesman.config.json`, nothing is downloaded: `install <language…>` and `install --all` fail with a hint to use `--from`, and the server leaves files of uncached languages on the text tier. Grammars that are already cached keep working.

Exit code: `0` when every requested grammar is bundled, cached or was installed; `1` when one failed (unknown language, network error, wrong hash, offline, file not found in `--from`).

Six on-demand grammars come with a symbols query (`scala`, `ocaml`, `fsharp`, `r`, `codeql`, `arduino`): once cached, files of those languages are parsed and their functions, classes and modules are indexed. The other 18 are listed as `text tier`: they are pinned and installable, but no symbols query exists for them yet, so Hesman indexes their files as text and never downloads them automatically.

### `list --json` output

```json
{
  "abi": { "min": 13, "max": 15 },
  "cacheDir": "/Users/me/Library/Caches/hesman/grammars/abi-15",
  "offline": false,
  "totals": { "bundled": 16, "bundledBytes": 27327695, "cached": 1, "cachedBytes": 487039, "onDemand": 24, "onDemandBytes": 46893269 },
  "grammars": [
    {
      "id": "r",
      "state": "cached",
      "bytes": 487039,
      "abi": 14,
      "symbols": true,
      "extensions": [".r"],
      "license": "MIT",
      "repo": "https://github.com/r-lib/tree-sitter-r",
      "rev": "v1.3.0",
      "url": "https://github.com/r-lib/tree-sitter-r/releases/download/v1.3.0/tree-sitter-r.wasm",
      "sha256": "3e406e27cec05a60ba3281e2da021187200b83d152d9eb0dcf0a731cbfbcc28d",
      "path": "/Users/me/Library/Caches/hesman/grammars/abi-15/r-3e406e27cec0.wasm"
    }
  ]
}
```

`state` is `bundled` (in the package), `cached` (downloaded and verified) or `available` (in the catalog, not downloaded). `symbols` is `false` for a grammar without a symbols query. `extensions` is present only when `symbols` is `true`; `path` only when `state` is `cached`. `onDemand` and `onDemandBytes` count the whole catalog, cached or not.

### Maintaining the catalog

`grammars.json` is generated: `npx tsx scripts/generate-grammar-manifest.ts` builds it from the bundled set (`scripts/download-parsers.ts`, `parsers/`, `NOTICE`) and the on-demand table in `scripts/grammar-catalog.ts`; a unit test fails while the committed file is out of date. Each on-demand entry is the `.wasm` asset of the grammar's own upstream release. After changing an entry or a query of an on-demand language, run `npx tsx scripts/verify-grammar-catalog.ts` (network): it downloads every pinned file through the same code the server uses, checks hash, size and ABI, and compiles the vendored queries against the grammar.
