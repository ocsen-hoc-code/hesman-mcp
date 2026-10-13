# Hesman MCP Server

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

🌐 **阅读语言:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | **中文** | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** 是一款新一代 MCP（模型上下文协议）服务器，它让 AI 编码代理能够深度理解你的代码库——符号、调用图、依赖关系和语义搜索——并让每个答案只消耗很少的 Token：在本仓库上，`get_context` 返回的 Token 比整个文件少 80–96%，调用者或引用列表比普通 JSON 小 66–72%（参见 [在本仓库上的实测](#在本仓库上的实测)）。一切都在你的机器上运行：无需外部 API，无需 LSP 服务器，你的代码绝不会被发送到任何地方。

---

## 目录

- [为什么选择 Hesman？](#为什么选择-hesman)
- [快速开始](#快速开始)
- [功能特性](#功能特性)
- [Token 缩减原理](#token-缩减原理)
- [安装与配置](#安装与配置)
- [卸载](#卸载)
- [工具参考](#工具参考)
- [配置项](#配置项)
- [CLI 参考](#cli-参考)
- [支持的语言](#支持的语言)
- [架构](#架构)
- [开发环境搭建](#开发环境搭建)
- [系统要求](#系统要求)
- [文档](#文档)
- [许可证](#许可证)

---

## 为什么选择 Hesman？

AI 编码代理功能强大但成本高昂。它们读取的每一行代码都要消耗 Token。当代理只需要一个函数时却发送整个文件，既浪费上下文，也浪费费用。

Hesman 通过以下方式解决这一问题：

- **只提供代理所需的内容**——一个聚焦的函数、它的调用者、它的被调用者，或受某次变更影响的符号。
- **精简并裁剪代码**——`get_context` 去除注释和空行，只返回关注位置周围的代码行，而不是整个文件。
- **紧凑列表**——调用者、被调用者、引用、符号和文件大纲都以按命名列组织的行返回，按文件分组，路径相对于项目；没有任何一行被丢弃。响应永远不会比其原始载荷更大（参见 [Token 缩减管道](#token-缩减管道)）。
- **在你的机器上运行**——无需 API 密钥，没有外部服务，也就没有它带来的延迟。你的代码永远不会离开你的机器。仅有的下载是首次使用时的嵌入模型和按需语言的语法；两者都可以关闭（`--no-semantic`、`HESMAN_GRAMMARS_OFFLINE=1`）。
- **可量化的节省**——除 `index_status` 外，每个工具响应都包含 `_meta.reduction`，精确显示相比原始输出节省了多少 Token。

结果：代理运行更快、成本更低、推理更准确，因为它们看到的是正确的代码，而不是全部代码。

---

## 快速开始

`hesman-mcp` 尚未发布到 npm registry，因此目前需要从源码安装 Hesman：

```bash
# 1. 获取并构建 Hesman（Node.js ≥ 20）
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers
npm run build

# 2. 将其注册到你的 AI 客户端（自动检测 Claude Code、Cursor、VS Code、Codex……）
node dist/index.js setup
```

重启客户端并打开一个项目。`setup` 会写入与 Hesman 安装方式相匹配的启动命令（此处为 `node` 和 `dist/index.js` 的绝对路径，因此不需要任何东西位于 PATH 上）；参见[启动命令](#启动命令)。

包发布之后，整个快速开始将变成一行：

```bash
npx -y hesman-mcp setup   # 仅在 hesman-mcp 发布到 npm 之后
```

服务器会立即响应你的代理，并在后台建立索引（大多数项目只需几秒）：11 个工具立刻可用，在索引尚未完成期间会用 `_meta.indexing` 标记结果，`index_status` 则报告进度。

---

## 功能特性

### 代码智能

| 能力 | 描述 |
|---|---|
| **符号查找** | 按名称查找函数、类、方法——精确、模糊或前缀匹配（< 1ms） |
| **调用图遍历** | 沿调用者和被调用者遍历，最多 3 层深度 |
| **引用追踪** | 查找符号在整个代码库中的每一处使用 |
| **影响分析** | 查看重命名、删除符号或更改其签名会破坏哪些代码 |
| **语义搜索** | 用自然语言描述你要找的内容，找到匹配的代码 |
| **结构搜索** | 查找 `console.$METHOD($$$ARGS)` 这类带命名捕获的代码模式 |
| **依赖分析** | 查看一个文件导入了什么，以及哪些文件导入了它 |
| **上下文窗口** | 获取文件中任意位置周围聚焦且精简的代码 |

### Token 缩减管道

Hesman 以三种方式减少 Token。每个响应都会在 `_meta.reduction` 中报告其实际节省量，并且响应永远不会比其原始载荷更大。

| 层级 | 技术 | 实测节省 | 适用于 |
|---|---|---|---|
| **紧凑模式** | 去除注释、空行和行尾空白 | 代码片段的 0–16%，取决于其中注释和空行的多少（`mode: "full"` 对比 `"compact"`） | `get_context` |
| **上下文裁剪** | 返回关注位置周围的行范围，而不是整个文件 | 默认 ±5 行时为 96.0%，±40 行时为 79.7%（514 行的文件）；请求整个文件时为 0% | `get_context` |
| **紧凑列表** | 按命名列组织的行，按文件分组，路径相对于项目 | 调用者、被调用者和引用为 66–72%；符号列表、文件大纲、依赖关系和影响分析为 35–41% | `find_symbol`、`get_references`、`get_callers`、`get_callees`、`get_file_structure`、`list_dependencies`、`impact_analysis` |

`find_pattern` 和 `semantic_search` 返回其原始载荷（`_meta.reduction: "0.0%"`）。数据来自本仓库；完整表格及复现方法见 [在本仓库上的实测](#在本仓库上的实测)。每个响应中的 `_meta.reduction` 字段会报告你的工作负载的确切节省量。

### 生产就绪

- **工作线程池**——跨 CPU 核心并行索引，默认自动确定大小
- **文件监听**——通过 chokidar 在文件变更时进行增量重新索引
- **优雅关闭**——排空正在执行的任务，刷新存储，干净地终止工作线程
- **内容哈希索引**——仅当文件内容实际发生变化时才重新解析
- **Monorepo 支持**——自动检测 pnpm、lerna、nx、turbo 和 npm workspaces
- **诊断**——`hesman diag` 输出内存、存储统计、线程池状态和缓存指标
- **本地测试**——完整的测试套件（包括通过真实服务器进行的端到端测试）在 macOS 上运行；Linux 和 Windows 尚未验证

---

## Token 缩减原理

### 第一层：紧凑模式

去除注释、空行和行尾空白，同时保留魔法注释（`// @ts-ignore`、`// eslint-disable-*`）。

压缩前：
```typescript
// This function calculates the total price
// including tax and shipping
function calculateTotal(
  items: CartItem[],      // shopping cart items
  taxRate: number,        // local tax rate
): number {
  let total = 0;

  // Sum up item prices
  for (const item of items) {
    total += item.price * item.quantity;
  }

  // Apply tax
  total = total * (1 + taxRate);

  return total;
}
```

压缩后：
```typescript
function calculateTotal(
  items: CartItem[],
  taxRate: number,
): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  total = total * (1 + taxRate);
  return total;
}
```

### 第二层：上下文裁剪

`get_context` 不会返回整个文件。它返回所请求的行范围，加上其上方和下方各 `contextLines` 行（默认 5，最大 200），然后对该片段应用紧凑模式。`_meta.reduction` 将结果与整个文件进行比较，`_meta.layers` 则列出应用了哪些层（`compact`、`prune`）。

裁剪只按行范围进行：它不会跟随调用者或被调用者。要阅读一个函数调用了什么或什么调用了它，请先向 `get_callees` / `get_callers` 询问位置，然后对每个位置调用 `get_context`。

### 第三层：紧凑列表

列表答案的每一行都会重复相同的内容：很长的文件路径、字段名，以及从不变化的值。紧凑形式只把它们各写一次：字段名写在 `columns` 中，路径每个文件只写一次，且相对于项目。以下是一个真实的 `get_callers` 答案：

```json
{
  "format": "compact",
  "columns": ["symbolId", "name", "kind", "line", "depth", "callLine", "callFile"],
  "files": [
    { "file": "src/indexing/file-watcher.ts", "rows": [["a182668c09c39b47", "scan", "method", 78, 1, 79, null]] }
  ],
  "_meta": { "originalTokens": 101, "compressedTokens": 54, "reduction": "46.5%", "compressed": true, "layers": ["group", "columns", "paths"] }
}
```

没有任何一行被丢弃，也没有任何内容被摘要掉；`symbolId`、相对的 `file` 和 `line` 可以直接传给其他工具。`get_file_structure` 和 `list_dependencies` 使用一个扁平的 `rows` 列表。当紧凑形式不会更小时（空列表、单行），返回原始载荷。对这些工具中的任意一个传入 `format: "full"`，即可获得带绝对路径的普通对象。长列表通过 `topK` 分页获取，对于 `get_references` 还可以使用 `cursor`。

### 衡量节省量

除 `index_status` 外，每个工具响应都包含一个 `_meta` 块，给出实际的 Token 节省量：

```json
{
  "_meta": {
    "originalTokens": 4782,
    "compressedTokens": 190,
    "reduction": "96.0%",
    "compressed": false,
    "layers": ["prune"]
  }
}
```

这个示例是一次真实的 `get_context` 调用（默认 ±5 行，紧凑模式），针对一个 514 行的文件：片段已经由该工具精简过，所以只列出了 `prune` 层，而 `compressed: false` 表示响应压缩器已经没有更多可移除的内容。`_meta.reduction` 字段以原始完整文件的 Token 数为基准进行衡量，给出真实的端到端节省量。不会变小的响应会原样返回，并带有 `reduction: "0.0%"`；该值永远不会为负。查看任意工具响应上的 `_meta.reduction`，即可精确核查 Hesman 在你的实际工作负载中节省了多少。

---

## 安装与配置

### 前提条件

- **Node.js** ≥ 20.0.0
- **npm**（或 pnpm / yarn）

### 从源码安装

这是目前可行的方式。

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # 下载 Tree-sitter WASM 解析器
npm run build              # 编译 TypeScript
npm link                   # 可选：让 `hesman` 在 PATH 上可用
```

如果不执行 `npm link`，请在本 README 写 `hesman` 的地方改用 `node /path/to/hesman-mcp/dist/index.js`。

### 从 npm 安装（待包发布之后）

`hesman-mcp` 尚未发布到 npm registry。发布之后：

```bash
npx -y hesman-mcp setup     # 无需安装：客户端通过 npx 启动 Hesman
npm install -g hesman-mcp   # 或者全局安装，把 `hesman` 放到 PATH 上
```

### 注册到 AI 代理

```bash
hesman setup                         # 本机上找到的客户端的勾选清单
hesman setup --yes                   # 不提问：配置每一个检测到的客户端
hesman setup --client cursor vscode  # 配置指定的客户端
hesman setup --dry-run --all         # 打印每个客户端的确切改动，不写入任何内容
hesman remove                        # 撤销：把 Hesman 从每个客户端中再移除
```

| 客户端 | `--client` | `hesman setup` 修改的内容（用户作用域） | `--scope project` |
|---|---|---|---|
| Claude Code | `claude-code` | 运行 `claude mcp add --scope user hesman -- <launch command>`；没有该 CLI 时，编辑 `~/.claude.json` | `.mcp.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` | — |
| OpenAI Codex CLI | `codex` | 运行 `codex mcp add hesman -- <launch command>`；没有该 CLI 时，编辑 `~/.codex/config.toml` | `.codex/config.toml` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Google Antigravity | `antigravity` | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| VS Code (Copilot) | `vscode` | VS Code 用户目录中的 `mcp.json` | `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Windsurf | `windsurf` | `~/.config/devin/mcp_config.json` | — |

- 只会改动 `hesman` 这一个条目。被修改的文件会先复制为 `<file>.hesman.bak`；如果期间没有其他改动，`hesman remove` 会将其逐字节还原。
- 该条目不含项目路径：Hesman 会自行找到项目（见下文）。有两个例外：**Claude Desktop** 没有工作区，因此它的条目会固定一个项目（当前目录，或 `--project-root <path>`）；**Cursor** 仅在项目作用域中获得 `--project-root ${workspaceFolder}`（在全局的 `~/.cursor/mcp.json` 中，该变量可能是你的主目录，所以全局条目不指定项目）。
- 对于 **Antigravity** 和 **Windsurf**，项目如何传递给服务器并没有文档说明；`hesman setup` 会打印一条提示，请你在首次启动后进行检查。
- 带注释的配置文件（JSONC）不会被编辑：`hesman setup` 会报告它们并保持原样。
- `hesman install --agent <name>` 仍然可用，它是 `hesman setup --client <name> --yes` 的已弃用别名。

配置完成后，重启客户端，Hesman 即可作为 MCP 服务器使用。

### 代理使用规则（可选启用）

安装了 MCP 服务器并不等于它就会被使用：代理常常还是习惯用 grep 和读取整个文件。`hesman setup --rules` 还会向每个所选客户端在**当前项目**中读取的指令文件写入一小段内容（14 行），说明哪个 Hesman 工具回答哪类问题。它是否会改变代理调用这些工具的频率，目前尚未测量。

```bash
hesman setup --client claude-code codex --rules   # 在项目内运行
hesman setup --all --rules --dry-run              # 打印该内容块和相关文件，不写入任何内容
hesman remove                                     # 同时也会再删除该内容块
```

| 客户端 | 指令文件（相对于项目） |
|---|---|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex CLI、Windsurf | `AGENTS.md` |
| Gemini CLI、Google Antigravity | `GEMINI.md` |
| Cursor | `.cursor/rules/hesman.mdc`（它自己的规则文件，`alwaysApply: true`） |
| VS Code (Copilot) | `.github/copilot-instructions.md` |
| Claude Desktop | 无：它不读取任何项目文件，因此会被跳过并给出提示 |

- **可选启用。** 不带 `--rules` 就不会写入任何内容。在终端中不带 `--yes` 运行时，setup 会询问一次，默认回答为“否”。
- 该内容块位于 `<!-- hesman:rules:start -->` 和 `<!-- hesman:rules:end -->` 之间。再次运行 setup 会原地替换它；标记之外的文本绝不会被改动，由两个客户端共用的文件只会写入一次该内容块。
- `hesman remove` 只删除该内容块，并将文件逐字节还原；由 Hesman 创建且不含其他内容的文件会被删除。请在同一个项目中运行它（或传入 `--project-root <path>`，`setup --rules` 同样接受该参数）。
- 这些文件通常会提交到 git 并与团队共享。setup 会列出它修改过的文件，以便你审查（`git diff`）并决定是否提交。

### 启动命令

`hesman setup --command auto|npx|global|absolute` 决定客户端运行什么。setup 从不使用网络。

| `--command` | 写入的条目 | 需要 |
|---|---|---|
| `npx` | `npx -y hesman-mcp@<major>` | npm 上有该包（尚未发布），且 `npx` 位于客户端的 PATH 上；Node 升级后依然有效 |
| `global` | `hesman` | 全局安装（或 `npm link`），且位于客户端的 PATH 上 |
| `absolute` | `/path/to/node /path/to/hesman-mcp/dist/index.js` | PATH 上不需要任何东西；切换 Node 版本或移动 Hesman 之后需重新运行 `hesman setup` |

`auto`（默认值）会查看正在运行的 Hesman 是如何启动的：

1. 通过 `npx` 启动（它从 `_npx` 缓存目录运行）→ `npx`；
2. PATH 上的 `hesman` 就是这同一份安装（已解析符号链接）→ `global`；
3. 其他任何情况（源码检出、本地 `node_modules`、不在 PATH 上）→ `absolute`。

从 Dock 或启动器打开的桌面应用（Claude Desktop、Cursor、Antigravity、VS Code、Windsurf）拿不到你的 shell PATH。在 macOS 和 Linux 上，当 `auto` 选择了 `npx` 或 `hesman`，而该命令或 `node` 不在标准系统目录（`/usr/bin`、`/bin`、`/usr/sbin`、`/sbin`、`/usr/local/bin`，以及 macOS 上的 `/opt/homebrew/bin` 和 Linux 上的 `/snap/bin`）中时——使用 nvm、fnm、volta 或 asdf 时通常如此——这些客户端会改为获得 `absolute` 条目，并附带一条提示：切换 Node 版本后请重新运行 `hesman setup`。终端客户端（Claude Code、Codex CLI、Gemini CLI）继承 shell 环境，并保留所选的命令。显式指定的 `--command npx|global` 会按要求写入每个客户端，并在桌面应用可能找不到它的地方给出警告。

### 手动 MCP 配置

将以下内容添加到代理的 MCP 配置文件中（VS Code 使用 `"servers"` 而不是 `"mcpServers"`，并且条目中需要 `"type": "stdio"`；Codex 使用 `[mcp_servers.hesman]` TOML 表）：

```json
{
  "mcpServers": {
    "hesman": {
      "command": "hesman",
      "args": ["--project-root", "/path/to/your/project"],
      "env": {}
    }
  }
}
```

`--project-root` 是可选的；见下文。`"command": "hesman"` 要求 `hesman` 位于客户端所看到的 PATH 上；否则请使用 `"command": "/path/to/node"`，并将 `"/path/to/hesman-mcp/dist/index.js"` 作为第一个参数（参见[启动命令](#启动命令)）。

### Hesman 如何选择项目

一个服务器进程索引一个项目。项目按以下顺序选定：

1. **显式根目录**——`--project-root <path>`、`HESMAN_PROJECT_ROOT`，或 `hesman.config.json` 中的 `projectRoot`。始终优先。
2. **MCP 客户端的工作区文件夹**——当客户端支持 MCP 的 `roots` 能力时，Hesman 会在握手之后向它询问其文件夹，并索引第一个（其他文件夹只记入日志，不做索引）。当客户端之后报告了不同的文件夹时，Hesman 会切换过去。
3. **工作目录**——从服务器的工作目录本身向上查找，最近的一个包含版本控制目录（`.git`、`.hg`、`.svn`、`.jj`）或项目清单文件（`package.json`、`go.mod`、`pyproject.toml`、`Cargo.toml`……）的目录。
4. **没有项目**——服务器仍会启动并列出其工具，但每个工具都会返回 `NO_PROJECT` 错误，并说明如何设置根目录。

主目录及其上级目录绝不会被自动选中（第 2 步和第 3 步），因此从 `~` 启动的全局 MCP 条目不会遍历你的整个磁盘。索引存放在所选项目内的 `.hesman/` 中。

## 卸载

Hesman 的数据保存在四个地方。请按此顺序删除，因为前两步需要 `hesman` 命令。

**1. 将 Hesman 从你的 AI 客户端中移除**

```bash
hesman remove --dry-run        # 显示将被移除的内容，不写入任何内容
hesman remove                  # 从每个含有 hesman 条目的客户端中移除该条目（用户作用域）
hesman remove --scope project  # 在使用 --scope project 设置的项目中运行
```

`hesman remove` 只删除 `hesman` 条目；如果你使用过 `hesman setup --rules`，还会删除项目指令文件中 `<!-- hesman:rules:start -->` 与 `<!-- hesman:rules:end -->` 之间的内容块，文件中的其他内容保持不变。之后请重启客户端。客户端配置文件旁边的 `<config>.hesman.bak` 文件是 Hesman 在上次编辑前创建的备份，不再需要时可以删除。

**2. 删除每个项目的索引**

```bash
cd /path/to/project
hesman clean --dry-run   # 显示该目录及其大小
hesman clean --force     # 删除 .hesman/（索引、向量、日志、工具调用日志）
```

在 Hesman 使用过的每个项目中重复此操作，或手动删除项目的 `.hesman/` 目录。如果你设置了 `HESMAN_DATA_DIR` 或 `--data-dir`，数据则位于该目录中。

**3. 删除语法缓存**

按需下载的语法按用户保存，位于任何项目之外。请删除第一个适用位置中的 `hesman` 目录：

| 设置 / 平台 | 要删除的目录 |
|---|---|
| 已设置 `HESMAN_CACHE_DIR` | `$HESMAN_CACHE_DIR/hesman` |
| 已设置 `XDG_CACHE_HOME` | `$XDG_CACHE_HOME/hesman` |
| macOS | `~/Library/Caches/hesman` |
| Windows | `%LOCALAPPDATA%\hesman` |
| Linux 及其他 | `~/.cache/hesman` |

`hesman grammars list` 会打印确切的缓存目录。如果从未下载过按需语法，该目录不存在。

**4. 删除程序本身**

```bash
# 从源码安装
npm unlink -g hesman-mcp   # 仅当你运行过 `npm link` 时
rm -r /path/to/hesman-mcp  # 克隆下来的仓库

# 从 npm 安装（包发布之后）
npm uninstall -g hesman-mcp
```

嵌入模型存放在包自身的 `node_modules` 中，因此会随程序一起消失。除上述位置外，不会在其他地方写入任何内容：没有后台服务，也没有系统级配置。

---

## 工具参考

Hesman 通过 MCP stdio 传输提供 **11 个工具**。除 `index_status` 外，每个工具响应都包含一个带有 Token 节省量的 `_meta` 块（`impact_analysis` 还会返回它自己的、关于受影响文件的 `_summary`）。

### 代码导航

| 工具 | 功能 | 主要输入参数 |
|---|---|---|
| `find_symbol` | 按名称查找符号，支持精确、模糊或前缀匹配 | `name`、`kind`、`matchMode`、`topK` |
| `get_file_structure` | 获取文件中所有符号的层次结构树 | `filePath`、`includeNested` |
| `get_references` | 在整个代码库中查找一个符号的所有使用位置 | `symbolId`、`referenceKind`、`topK`、`cursor` |
| `get_context` | 获取指定位置周围精简后的代码 | `filePath`、`startLine`、`contextLines`、`mode` |

### 调用图

| 工具 | 功能 | 主要输入参数 |
|---|---|---|
| `get_callers` | 查找所有调用给定符号的函数（最多 3 层深度） | `symbolId`、`maxDepth`、`topK` |
| `get_callees` | 查找给定符号调用的所有函数（最多 3 层深度） | `symbolId`、`maxDepth`、`topK` |

### 分析

| 工具 | 功能 | 主要输入参数 |
|---|---|---|
| `impact_analysis` | 对符号变更（重命名/删除/签名变更）会破坏的内容进行分类 | `symbolId`、`changeType` |
| `list_dependencies` | 显示一个文件导入了什么，或哪些文件导入了它 | `filePath`、`direction` |
| `semantic_search` | 通过自然语言描述搜索代码 | `query`、`topK`、`language`、`kind` |
| `find_pattern` | 按带命名捕获（`$NAME`、`$$$ARGS`）的结构模式进行搜索 | `pattern`、`language`、`topK` |

### 状态

| 工具 | 功能 |
|---|---|
| `index_status` | 报告索引健康状况：文件数、符号数、存储状态、待处理文件、初始后台索引的进度 |

完整的输入/输出 schema 及示例，请参阅 **[docs/TOOLS.md](../TOOLS.md)**。

---

## 配置项

在项目根目录创建 `hesman.config.json`（所有字段均为可选）：

```json
{
  "projectRoot": ".",
  "workers": 0,
  "watchMode": true,
  "languages": ["*"],
  "ignore": ["node_modules/**", "dist/**", ".git/**", "legacy/**"],
  "semanticSearch": {
    "enabled": true,
    "defaultTopK": 10,
    "maxTopK": 50,
    "embeddingModel": "Xenova/all-MiniLM-L6-v2"
  },
  "logLevel": "info",
  "dataDir": ".hesman",
  "grammars": { "offline": false }
}
```

> **索引时会跳过符号链接。** 项目扫描器和文件监听器从不跟随符号链接（无论指向文件还是目录）。这可以防止无限循环（例如 `loop -> .`），让项目之外的代码不进入索引，并避免重复的符号。要索引被链接的代码，请将 `projectRoot` 指向真实目录。

### 配置优先级

配置按以下顺序解析（后者覆盖前者）：

1. **默认值**——Hesman 内置
2. **`hesman.config.json`**——项目级配置文件
3. **环境变量**——例如 `HESMAN_WORKERS=4`
4. **CLI 标志**——例如 `--workers 4`

### 环境变量

| 变量 | 等效项 | 描述 |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | 待索引项目的路径 |
| `HESMAN_WORKERS` | `--workers N` | 工作线程数（0 = 自动检测） |
| `HESMAN_LOG_LEVEL` | `--log-level` | 可选值：trace、debug、info、warn、error |
| `HESMAN_DATA_DIR` | `--data-dir` | 索引数据存放目录（默认：`.hesman`） |
| `HESMAN_WATCH_MODE` | `--watch-mode` | 启用/禁用文件监听（true/false） |
| `HESMAN_GRAMMARS_OFFLINE` | — | `1` 或 `true`：绝不下载语法（配置键 `grammars.offline`） |
| `HESMAN_CACHE_DIR` | — | 存放每用户语法缓存的目录（`<dir>/hesman/grammars/`） |

### CLI 标志

| 标志 | 描述 |
|---|---|
| `--project-root <path>` | 要索引的项目（默认：自动检测，参见 [Hesman 如何选择项目](#hesman-如何选择项目)） |
| `--workers <N>` | 工作线程数（0 = 自动） |
| `--log-level <level>` | 日志级别 |
| `--data-dir <path>` | 数据目录路径 |
| `--watch-mode` | 启用文件监听 |
| `--no-watch` | 禁用文件监听 |
| `--no-semantic` | 禁用语义搜索 |
| `--batch-size <N>` | 每个索引批次的文件数 |

---

## CLI 参考

```
hesman                         Run the MCP server over stdio (default)
hesman index [path]            Index a project without starting the server
hesman status [path]           Show indexing progress and statistics
hesman clean [path]            Delete the .hesman/ data directory
hesman clean --force           Skip confirmation prompt
hesman clean --dry-run         Preview what would be deleted without removing
hesman diag [path]             Print diagnostics: memory, store stats, pool, cache
hesman diag --json             Output diagnostics as JSON
hesman setup                   Add Hesman to your AI clients (--client, --all, --yes, --dry-run, --scope, --project-root, --command, --rules)
hesman remove                  Remove Hesman from the clients again (--client, --all, --scope, --dry-run)
hesman doctor                  Check the installation and each client's entry (--client, --json, --timeout)
hesman ui [path]               Open the local dashboard: logs, metrics, index graph, playground (--port, --no-open)
hesman grammars list           Bundled, cached and on-demand grammars with sizes (--json)
hesman grammars install <lang…> Download grammars into the cache (--all, or --from <directory> without network)
hesman install --agent <name>  Deprecated alias of: hesman setup --client <name> --yes
hesman --version, -v           Print version number
hesman --help, -h              Show help text
```

---

## 支持的语言

| 语言 | 扩展名 | 等级 | 语法（grammar） | 可用功能 |
|---|---|---|---|---|
| TypeScript | `.ts`、`.mts`、`.cts` | deep | 内置 | 符号、调用图、影响分析 |
| TSX | `.tsx` | deep | 内置 | 符号、调用图、影响分析 |
| JavaScript（含 JSX） | `.js`、`.jsx`、`.mjs`、`.cjs` | deep | 内置 | 符号、调用图、影响分析 |
| Python | `.py`、`.pyw`、`.pyi` | deep | 内置 | 符号、调用图、影响分析 |
| Go | `.go` | deep | 内置 | 符号、调用图、影响分析 |
| Java | `.java` | deep | 内置 | 符号、调用图、影响分析 |
| C | `.c`、`.h` | deep | 内置 | 符号、调用图、影响分析 |
| C++ | `.cpp`、`.cc`、`.cxx`、`.hpp`、`.hh`、`.hxx`、`.ipp`、`.tpp` | deep | 内置 | 符号、调用图、影响分析 |
| C# | `.cs`、`.csx` | deep | 内置 | 符号、调用图、影响分析 |
| Rust | `.rs` | deep | 内置 | 符号、调用图、影响分析 |
| PHP | `.php`、`.phtml` | deep | 内置 | 符号、调用图、影响分析 |
| Ruby | `.rb`、`.rake`、`.gemspec`、`.ru`、`.podspec` | deep | 内置 | 符号、调用图、影响分析 |
| Kotlin | `.kt`、`.kts` | deep | 内置 | 符号、调用图、影响分析 |
| Swift | `.swift` | deep | 内置 | 符号、调用图、影响分析 |
| Bash | `.sh`、`.bash` | deep | 内置 | 符号、调用图、影响分析 |
| Lua | `.lua` | deep | 内置 | 符号、调用图、影响分析 |
| Scala | `.scala`、`.sc`、`.sbt` | structural | 按需下载 | 仅符号（无调用图） |
| OCaml | `.ml` | structural | 按需下载 | 仅符号（无调用图） |
| F# | `.fs`、`.fsx` | structural | 按需下载 | 仅符号（无调用图） |
| R | `.r` | structural | 按需下载 | 仅符号（无调用图） |
| CodeQL | `.ql`、`.qll` | structural | 按需下载 | 仅符号（无调用图） |
| Arduino | `.ino` | structural | 按需下载 | 仅符号（无调用图） |
| Elixir | `.ex`、`.exs` | structural | 按需下载 | 仅符号（无调用图） |
| 其他所有文件 | 任意文本文件 | text | 无 | 供 `semantic_search`、`find_pattern` 和 `get_context` 使用的文本块（无符号） |

上表由语言注册表生成（`npx tsx scripts/generate-language-matrix.ts`；表格过期时会有一项测试失败）。标记为*内置*的语法（grammar）随包一起发布，因此可以离线使用。

**按需语法。** 标记为*按需下载*的语法不在包内。项目中第一次出现这类语言的文件时，这些文件会立即按文本索引，同时服务器在后台下载语法（每个语法 0.3–11.4 MB，来自该语法自身 GitHub 仓库的 release 页面）；下载完成后，这些文件会带符号重新索引。每个语法都在随包发布的 `grammars.json` 中以 URL、大小和 sha256 固定；不匹配的下载会被丢弃，文件保持为文本。语法按用户缓存，位于项目之外：`HESMAN_CACHE_DIR`，否则 `XDG_CACHE_HOME`，否则 `~/Library/Caches`（macOS）、`%LOCALAPPDATA%`（Windows）或 `~/.cache`，其下的 `hesman/grammars/`。

- **关闭下载：** 设置 `HESMAN_GRAMMARS_OFFLINE=1`，或在 `hesman.config.json` 中设置 `"grammars": { "offline": true }`。此后 Hesman 不会为语法发出任何网络请求；按需语言的文件会停留在 text 等级，除非其语法已在缓存中。
- **预先填充缓存：** `hesman grammars install scala r` 或 `hesman grammars install --all`（46.9 MB）；在无法联网的机器上，把 `.wasm` 文件复制过去，然后运行 `hesman grammars install --from <directory>`。`hesman grammars list` 会显示哪些是内置的、已缓存的和可获取的。参见 [docs/CLI.md](../CLI.md#hesman-grammars)。
- **查看缺少什么：** `index_status` 按语言列出其等级（`deep`、`structural` 或 `text`）、文件数量，以及其语法是内置、已缓存还是缺失，并说明原因。

`grammars.json` 还固定了 17 个尚无符号查询的语法（Haskell、Zig、Julia、Perl、Objective-C、Odin、Luau、Starlark、HTML、CSS、JSON、YAML、TOML、XML、Markdown、HCL、Make）。它们可以通过 `hesman grammars install` 安装，但 Hesman 目前还不使用它们：这些语言的文件按文本索引，其语法绝不会被自动下载。

各等级目前的含义：

- **deep**——定义（函数、类、方法、常量……）加上 `calls` 关系，因此 `get_callers`、`get_callees`、`get_references` 和 `impact_analysis` 拥有调用图。调用从每种语言的语法树中读取（其调用表达式、`new X(...)`、Ruby 和 Bash 不带括号的调用），并按名称链接：先是调用者自己的文件，然后是它导入的文件、它所在的目录，最后是整个项目；仍有歧义的名称会保持未链接，而不是链接到每一个候选。调用会链接到定义，而不是没有函数体的声明（C/C++ 原型、接口方法或抽象方法）；`new X(...)` 会链接到类 `X`，而不是它的某个构造函数。类型不会被解析，因此在有多个实现的接口上调用的方法会保持未链接，不带参数也不带括号调用的 Ruby 方法不会被识别为调用。导入关系适用于 TypeScript/JavaScript、Python、Go、C/C++（`#include "..."`）和 Ruby（`require`、`require_relative`）；`extends` / `implements` 关系仅在语言写作 `class X extends Y` 或 `class X implements Y` 的地方存在。
- **structural**——仅有定义。已经没有内置语言处于这一等级。按需语言之所以是 structural，是因为只使用了它们上游的符号查询：它们没有可见性规则（每个定义都算作已导出），也没有调用提取。
- **text**——没有符号；参见 [docs/TOOLS.md](../TOOLS.md) 中的“Text tier”。

代理不必了解这张表：当针对一个没有调用图的语言的符号调用 `get_callers`、`get_callees`、`get_references` 或 `impact_analysis` 时，响应会在空列表旁带上一条 `note`，例如 `call graph not available for r (symbols only)`，这样空结果就不会被误认为“没有任何地方使用它”。

符号类型遵循各语法自己的 tags 查询，因此有些比语言本身更粗略：PHP 和 Kotlin 的方法是 `function`，Rust 和 Swift 的枚举以及 Kotlin 的接口是 `class`，Rust 的类型别名是 `class`。添加一种语言需要一个语法、一个 tags 查询、一个小型 profile，以及语言注册表（`src/parsers/languages.ts`）中的一个条目——分步说明请参阅[贡献指南](../CONTRIBUTING.md)。

---

## 架构

```
                         ┌──────────────────────────────────────┐
                         │         AI Agent (Claude, etc.)       │
                         │              │  MCP stdio              │
                         └──────────────┼─────────────────────────┘
                                        │
                         ┌──────────────┼─────────────────────────┐
                         │       Hesman MCP Server                │
                         │              │                          │
                         │   ┌──────────┴──────────────────────┐  │
                         │   │      Token Reduction Pipeline    │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Compact Mode            │  │  │
                         │   │  │    Strip comments/blanks    │  │  │
                         │   │  │ 2. Context Pruning         │  │  │
                         │   │  │    A line range, not a file │  │  │
                         │   │  │ 3. Compact Lists           │  │  │
                         │   │  │    Columns, grouped by file │  │  │
                         │   │  └────────────────────────────┘  │  │
                         │   └───────────────────────────────────┘  │
                         │                                          │
                         │   ┌──────────┐ ┌──────────┐ ┌─────────┐ │
                         │   │  SQLite  │ │   ZVec   │ │ Worker  │ │
                         │   │  Store   │ │  Vector  │ │  Pool   │ │
                         │   │ (symbols)│ │ (search) │ │ (index) │ │
                         │   └────┬─────┘ └────┬─────┘ └────┬────┘ │
                         │        │            │            │       │
                         │   ┌────┴────────────┴────────────┴────┐  │
                         │   │     File Watcher (chokidar)       │  │
                         │   └───────────────────────────────────┘  │
                         └──────────────────────────────────────────┘
```

**核心数据管道：** 文件变更（chokidar）→ Tree-sitter 解析（AST + 符号）→ SQLite 索引 + ZVec 嵌入 → 紧凑的 MCP 响应

**关键设计决策：**
- **无 LSP 依赖**——Tree-sitter 提供与语言无关的解析，无需运行语言服务器
- **内容哈希增量索引**——仅当 SHA-256 发生变化时才重新解析文件
- **响应级压缩**——原始数据保持完整；压缩在响应边界处应用
- **每个项目一个 SQLite 数据库**——即使在 monorepo 中，所有包也共享一个存储，通过 `file_path` 隔离

完整的架构文档（包括模块依赖关系、存储 schema 和工作线程池设计）请参阅 **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**。

---

## 开发环境搭建

### 前提条件

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### 开始

```bash
# 克隆并安装
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# 下载 Tree-sitter WASM 解析器
npm run download:parsers

# 以开发模式运行（热重载）
npm run dev

# 构建生产版本
npm run build
```

### 代码质量

```bash
npm run typecheck    # TypeScript 类型检查
npm run lint         # ESLint
npm run format       # Prettier 格式化
```

### 运行测试

```bash
npm test                  # 运行所有测试（单元测试 + 集成测试）
npm run test:watch        # 开发时的监听模式
npm run test:e2e          # 端到端测试（启动完整服务器）
npm run test:perf         # 性能基准测试
```

### 性能阈值

`npm run test:perf` 在某个基准比其阈值更差时失败（`tests/perf/thresholds.ts`）。这些限值是在维护者的 macOS 机器上，针对仓库的 fixtures 检查的，并非对每个项目的保证；`semantic_search` 的计时不包含查询的嵌入。

| 基准项 | 阈值 |
|---|---|
| `find_symbol`（精确） | < 1ms |
| `find_symbol`（模糊） | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |

### 在本仓库上的实测

`node scripts/measure.mjs` 会启动已构建的服务器（通过 stdio），让它索引本仓库的一份干净导出（502 个文件：350 个含符号，152 个为文本；7,700 个符号，27,372 条关系），并通过 MCP 对每个工具调用 100 次。测量于 2026-10-13 进行，环境为 Apple M3 Pro（11 核，18 GB）、macOS、Node 24。你的数字取决于机器和项目；请运行该脚本获取你自己的数字。

| 启动、索引与内存 | 开启语义搜索 | `--no-semantic` |
|---|---:|---:|
| MCP 握手应答耗时 | 0.4 s | 0.2 s |
| 索引就绪耗时 | 70.2 s | 2.4 s |
| 磁盘上的索引 | 46.2 MB | 22.1 MB |
| 握手时的内存 | 286 MB | 195 MB |
| 索引完成后立即的内存 | 673 MB | 426 MB |
| 静置时的内存（最后一次调用后 35 秒） | 545 MB | 303 MB |

服务器在索引期间仍会响应工具调用；开启语义搜索时，70 秒中几乎全部用于在 CPU 上计算 5,760 个嵌入。内存为进程的物理占用，即活动监视器显示的数字。解析器线程仅在索引期间启动（默认最多四个），空闲 30 秒后释放。

| 工具 | 调用 | 中位数 | 原始 Token | 返回 Token | 缩减 |
|---|---|---:|---:|---:|---:|
| `get_context` | 一个函数，±5 行 | 0.39 ms | 4,782 | 190 | 96.0% |
| `get_context` | 一个函数，±40 行 | 0.46 ms | 4,782 | 970 | 79.7% |
| `get_references` | `indexProject` 的引用 | 0.29 ms | 3,026 | 854 | 71.8% |
| `get_callers` | `indexProject` 的调用者 | 0.24 ms | 1,244 | 373 | 70.0% |
| `get_callees` | `indexProject` 的被调用者 | 0.15 ms | 387 | 132 | 65.9% |
| `find_symbol` | 前缀 `index`，20 条结果 | 0.38 ms | 2,326 | 1,369 | 41.1% |
| `impact_analysis` | 删除 `indexProject` | 0.39 ms | 3,498 | 2,116 | 39.5% |
| `get_file_structure` | 一个源文件 | 0.34 ms | 3,474 | 2,270 | 34.7% |
| `list_dependencies` | 一个文件的导入 | 0.11 ms | 572 | 374 | 34.6% |
| `find_symbol` | 精确名称，1 条结果 | 0.14 ms | 214 | 197 | 7.9% |
| `find_pattern` | TypeScript 中的 `console.$M($$$A)` | 38.4 ms | 2,112 | 2,112 | 0.0% |
| `semantic_search` | 一个自然语言查询 | 2.75 ms | 3,880 | 3,880 | 0.0% |

“原始 Token”是以带绝对路径的普通 JSON 对象形式返回的载荷（对 `get_context` 而言即整个文件）；Token 按每 4 个字符估算。延迟是客户端对一次调用所见的时间，包括 MCP 帧开销。`semantic_search` 包含查询的嵌入计算。

完整的贡献指南（包括如何添加新语言）请参阅 **[docs/CONTRIBUTING.md](../CONTRIBUTING.md)**。

---

## 系统要求

| 资源 | 最低要求 |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **内存** | 静置约 300 MB，索引时（不含语义搜索）约 430 MB；静置约 550 MB，索引时（含语义搜索）约 670 MB（在 502 个文件的项目上测得，参见 [在本仓库上的实测](#在本仓库上的实测)） |
| **磁盘** | 包本身约 30 MB（内置语法），嵌入模型约 80 MB（一次性下载），若安装全部按需语法则最多再占 47 MB，另加 `.hesman/` 中的索引 |
| **网络** | 用于安装、首次使用时下载嵌入模型，以及项目中第一次出现某种按需语言时下载其语法。除此之外不需要；任何代码或查询都绝不会被发送到任何地方 |

嵌入模型（`all-MiniLM-L6-v2`）在首次使用时下载，并无限期缓存在 Transformers.js 缓存目录中。

---

## 文档

| 文档 | 内容 |
|---|---|
| [README.md](../../README.md) | 项目概述、安装和配置（本文件） |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | 完整架构：数据流、模块图、存储 schema、工作线程池设计 |
| [docs/CLI.md](../CLI.md) | 每个子命令：`setup`、`remove`、`doctor`、`ui`、`grammars`，及其选项和输出 |
| [docs/TOOLS.md](../TOOLS.md) | 全部 11 个工具的完整输入/输出 schema 及示例 |
| [docs/CONTRIBUTING.md](../CONTRIBUTING.md) | 开发环境搭建、测试指南、语言 profile 编写、PR 检查清单 |
| [docs/SECURITY.md](../SECURITY.md) | 威胁模型、对工具输入的防护、如何报告漏洞 |
| [CHANGELOG.md](../../CHANGELOG.md) | 版本历史与变更记录 |

---

## 许可证

[MIT](../../LICENSE) — Copyright (c) 2026 Minh Do

MIT 许可证涵盖为 Hesman 编写的代码。第三方软件保留其各自的许可证：

- **包内包含：** Tree-sitter 语法和查询文件，除 Elixir 查询（Apache-2.0，即其语法的许可证）外全部为 MIT；每一项都连同其仓库、修订版本和版权信息列在 [NOTICE](../../NOTICE) 中。
- **由 npm 作为依赖安装：** 全部采用宽松许可证（MIT、ISC、BSD、Apache-2.0）；完整列表见 [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md)。嵌入库 `@xenova/transformers` 和向量存储 `@zvec/zvec` 采用 Apache-2.0。
- **运行时下载：** 嵌入模型 `Xenova/all-MiniLM-L6-v2`（Apache-2.0）和按需语法（MIT，Elixir 和 HCL 除外：Apache-2.0）；见 [NOTICE](../../NOTICE)。嵌入库的依赖 `sharp` 会安装一个预构建的 libvips（LGPL-3.0-or-later），作为独立的共享库。
