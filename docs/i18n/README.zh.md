# Hesman MCP Server

[![CI](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **阅读语言:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** 是一款新一代 MCP（模型上下文协议）服务器，它让 AI 编码代理能够深度理解你的代码库——包括符号、调用图、依赖关系和语义搜索——并通过 3 层压缩管道大幅降低 Token 消耗（最佳场景下可达 97%）。一切在本地运行。无需外部 API。无需 LSP 服务器。

---

## 目录

- [为什么选择 Hesman？](#为什么选择-hesman)
- [快速开始](#快速开始)
- [功能特性](#功能特性)
- [Token 缩减原理](#token-缩减原理)
- [安装与配置](#安装与配置)
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

AI 编码代理功能强大但成本高昂。它们读取的每一行代码都消耗 Token。当代理只需要某个函数时，却要发送整个文件，这浪费了上下文窗口和费用。

Hesman 通过以下方式解决这一问题：

- **只提供代理所需的内容**——一个聚焦的函数、它的调用者、被调用者，或变更所影响的符号。
- **压缩每个响应**——3 层管道去除注释、裁剪无关代码，并对大量结果进行摘要。
- **用摘要替代原始数据**——代理不再收到包含 200 条引用的 JSON 数组，而是获取一个 `_summary` 块，其中包含按类型和文件分组的统计计数。
- **100% 本地运行**——无需 API 密钥，无需网络调用，无外部服务延迟。你的代码永远不会离开你的机器。
- **可量化的节省**——每个响应都包含 `_meta.reduction`，精确显示相比于原始输出节省了多少 Token。

结果：代理运行更快、成本更低、推理更准确，因为它们看到的是正确的代码，而不是全部代码。

---

## 快速开始

```bash
# 1. 全局安装
npm install -g hesman-mcp

# 2. 在你的项目中运行服务器
cd my-project
hesman

# 3. 注册到你的 AI 代理（Claude Desktop、Cursor、VS Code）
hesman install --agent claude
```

就这样。一旦初始索引完成（对大多数项目只需几秒钟），你的 AI 代理就可以通过 Hesman 的 11 个工具查询你的代码库。

---

## 功能特性

### 代码智能

| 能力 | 描述 |
|---|---|
| **符号查找** | 按名称查找函数、类、方法——精确、模糊或前缀匹配（< 1ms） |
| **调用图遍历** | 向上或向下追踪调用者和被调用者，最多 3 层深度 |
| **引用追踪** | 查找符号在整个代码库中的所有使用位置 |
| **影响分析** | 查看重命名、删除或更改符号签名会破坏哪些代码 |
| **语义搜索** | 用自然语言描述你要找的内容，查找匹配的代码 |
| **结构搜索** | 使用命名捕获（如 `console.$METHOD($$$ARGS)`）查找代码模式 |
| **依赖分析** | 查看文件的导入内容以及被哪些文件导入 |
| **上下文窗口** | 获取文件中任意位置附近聚焦且精简的代码 |

### Token 缩减管道

Hesman 的 3 层压缩管道在每个响应中减少 Token 用量。实际节省量通过每个响应中的 `_meta.reduction` 进行测量和报告。

| 层级 | 技术 | 典型节省 | 最佳情况 |
|---|---|---|---|
| **紧凑模式** | 去除注释、空行、行尾空白；移除未使用的导入 | 10–30% | ~35%（大量注释的代码） |
| **上下文裁剪** | 仅保留与查询符号相关的行；用计数标记替换省略的代码 | 50–80%（在紧凑模式基础上） | ~95%（大文件，小关注区域） |
| **智能摘要** | 将大型结果数组替换为聚合的 `_summary` 块；将调用链压缩为分组统计 | 70–90%（对列表类工具） | ~90%（500+ 条引用 → 摘要） |

**综合最佳情况：** 一个 430 行的文件通过 `get_context` 查询单个函数 → 裁剪为约 6 个相关行 + 紧凑模式 → **97.1% 的缩减**。这是理想场景；所有工具的典型使用平均可实现 20–70% 的缩减。

### 生产就绪

- **工作线程池**——跨 CPU 核心并行索引，默认自动调整大小
- **文件监听**——通过 chokidar 在文件变更时进行增量重索引
- **优雅关闭**——排空正在执行的任务，刷新存储，干净地终止工作线程
- **内容哈希索引**——仅当文件内容实际发生变化时才重新解析
- **Monorepo 支持**——自动检测 pnpm、lerna、nx、turbo 和 npm workspaces
- **诊断工具**——`hesman diag` 输出内存、存储统计、线程池状态和缓存指标
- **CI 测试**——在 Ubuntu、macOS 和 Windows 上使用 Node 20 和 22 运行

---

## Token 缩减原理

### 第一层：紧凑模式

去除注释、空行和行尾空白，同时保留魔法注释（`// @ts-ignore`、`// eslint-disable-*`）。级别 2 增加了 AST 感知的 JSDoc 处理和未使用导入的移除。

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

压缩后（级别 1）：
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

压缩后（级别 2——AST 感知，仅保留 JSDoc）：
```typescript
/**
 * Calculates the total price including tax.
 * @param items - Shopping cart items
 * @param taxRate - Local tax rate as decimal (e.g., 0.08)
 */
function calculateTotal(items: CartItem[], taxRate: number): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  total = total * (1 + taxRate);
  return total;
}
```

### 第二层：上下文裁剪

当代理查询 `get_context` 获取某个特定符号时，Hesman 仅返回相关代码：

```typescript
// ... (省略了 45 行：不相关的导入和辅助函数)

/**
 * Processes the incoming webhook payload.
 */
export async function handleWebhook(payload: WebhookPayload): Promise<Result> {
  // ... (函数体)
}

// ... (省略了 120 行：不相关的类定义)
```

裁剪保留的内容包括：目标符号的定义、其文档注释、同一文件内直接的调用者和被调用者，以及文件内的引用——其余内容统一替换为计数标记。

### 第三层：智能摘要

不再将 200 条引用以 JSON 数组的形式直接输出：

```json
{
  "_summary": {
    "totalCount": 200,
    "byKind": { "calls": 145, "imports": 38, "extends": 12, "type_ref": 5 },
    "byFile": [
      { "filePath": "src/services/payment.ts", "count": 34 },
      { "filePath": "src/controllers/checkout.ts", "count": 28 }
    ]
  }
}
```

代理随后可以通过 `cursor` 分页请求特定文件或类型的详细信息。

### 量化的节省

每个 Hesman 响应都包含一个 `_meta` 块，展示实际的 Token 节省：

```json
{
  "_meta": {
    "originalTokens": 2007,
    "compressedTokens": 58,
    "reduction": "97.1%",
    "layers": ["compact", "prune"]
  }
}
```

这让你能够精确审计 Hesman 在实际工作负载中为你节省了多少。

---

## 安装与配置

### 前提条件

- **Node.js** ≥ 20.0.0
- **npm**（或 pnpm / yarn）

### 从 npm 安装

```bash
npm install -g hesman-mcp
```

### 从源码安装

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # 下载 Tree-sitter WASM 解析器
npm run build              # 编译 TypeScript
npm link                   # 使 `hesman` 全局可用
```

### 注册到 AI 代理

```bash
# Claude Desktop（自动检测各平台的配置文件路径）
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code（配合 Copilot 或 Cline）
hesman install --agent vscode

# 使用 --global 写入用户级配置而非项目级配置
hesman install --agent claude --global
```

安装完成后，重启你的 AI 代理，Hesman 将作为一个 MCP 服务器可用。

### 手动 MCP 配置

将其添加到你的 MCP 配置文件中：

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

---

## 工具参考

Hesman 通过 MCP stdio 传输暴露 **11 个工具**。每个响应都包含一个包含 Token 节省信息的 `_meta` 块，以及在适用情况下聚合结果的 `_summary` 块。

### 代码导航

| 工具 | 功能 | 主要输入参数 |
|---|---|---|
| `find_symbol` | 通过名称（精确、模糊或前缀匹配）查找符号 | `name`、`kind`、`matchMode`、`topK` |
| `get_file_structure` | 获取文件中所有符号的层次结构树 | `filePath`、`includeNested` |
| `get_references` | 在整个代码库中查找一个符号的所有使用位置 | `symbolId`、`referenceKind`、`topK`、`cursor` |
| `get_context` | 获取指定位置附近精简后的代码 | `filePath`、`startLine`、`contextLines`、`mode` |

### 调用图

| 工具 | 功能 | 主要输入参数 |
|---|---|---|
| `get_callers` | 查找所有调用给定符号的函数（最多 3 层深度） | `symbolId`、`maxDepth`、`topK` |
| `get_callees` | 查找给定符号调用的所有函数（最多 3 层深度） | `symbolId`、`maxDepth`、`topK` |

### 分析

| 工具 | 功能 | 主要输入参数 |
|---|---|---|
| `impact_analysis` | 分类分析符号变更（重命名/删除/签名变更）会破坏哪些代码 | `symbolId`、`changeType` |
| `list_dependencies` | 显示文件的导入内容或被哪些文件导入 | `filePath`、`direction` |
| `semantic_search` | 通过自然语言描述搜索代码 | `query`、`topK`、`language`、`kind` |
| `find_pattern` | 使用带有命名捕获的模式（`$NAME`、`$$$ARGS`）进行结构搜索 | `pattern`、`language`、`topK` |

### 状态

| 工具 | 功能 |
|---|---|
| `index_status` | 报告索引健康状况：文件数、符号数、存储状态、待处理文件 |

完整的输入/输出模式及示例，请参阅 **[docs/TOOLS.md](./docs/TOOLS.md)**。

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
  "dataDir": ".hesman"
}
```

### 配置优先级

配置按以下顺序解析（后者覆盖前者）：

1. **默认值**——Hesman 内置
2. **`hesman.config.json`**——项目级配置文件
3. **环境变量**——例如 `HESMAN_WORKERS=4`
4. **CLI 标志**——例如 `--workers 4`

### 环境变量

| 变量 | 等效 CLI | 描述 |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | 待索引项目的路径 |
| `HESMAN_WORKERS` | `--workers N` | 工作线程数（0 = 自动检测） |
| `HESMAN_LOG_LEVEL` | `--log-level` | 可选值：trace、debug、info、warn、error |
| `HESMAN_DATA_DIR` | `--data-dir` | 索引数据存放目录（默认：`.hesman`） |
| `HESMAN_WATCH_MODE` | `--watch-mode` | 启用/禁用文件监听（true/false） |

### CLI 标志

| 标志 | 描述 |
|---|---|
| `--project-root <path>` | 项目根目录 |
| `--workers <N>` | 工作线程数（0 = 自动） |
| `--log-level <level>` | 日志级别 |
| `--data-dir <path>` | 数据目录路径 |
| `--watch-mode` | 启用文件监听 |
| `--no-watch` | 禁用文件监听 |
| `--no-semantic` | 禁用语义搜索 |
| `--batch-size <N>` | 每批次索引的文件数 |

---

## CLI 参考

```
hesman                         通过 stdio 运行 MCP 服务器（默认）
hesman index [path]            索引项目而不启动服务器
hesman status [path]           显示索引进度和统计信息
hesman clean [path]            删除 .hesman/ 数据目录
hesman clean --force           跳过确认提示
hesman clean --dry-run         预览将删除的内容而不实际删除
hesman diag [path]             打印诊断信息：内存、存储统计、线程池、缓存
hesman diag --json             以 JSON 格式输出诊断信息
hesman install --agent <name>  为 Claude Desktop、Cursor 或 VS Code 写入 MCP 配置
hesman install --global        写入用户级配置而非项目级配置
hesman --version, -v           打印版本号
hesman --help, -h              显示帮助文本
```

---

## 支持的语言

| 语言 | 扩展名 | 状态 |
|---|---|---|
| TypeScript / JavaScript | `.ts`、`.tsx`、`.js`、`.jsx`、`.mjs`、`.cjs`、`.mts`、`.cts` | 完全支持 |
| Python | `.py`、`.pyw`、`.pyi` | 完全支持 |
| Go | `.go` | 完全支持 |

该架构通过 Tree-sitter 支持最多 **158 种语言**。添加新语言需要实现 `LanguageProfile`——请参阅[贡献指南](./docs/CONTRIBUTING.md)了解分步说明。

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
                         │   │     3-Layer Compression Pipeline │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Compact Mode            │  │  │
                         │   │  │    Strip comments/blanks    │  │  │
                         │   │  │ 2. Context Pruning         │  │  │
                         │   │  │    Keep only relevant lines │  │  │
                         │   │  │ 3. Smart Summarization     │  │  │
                         │   │  │    Aggregate & compress     │  │  │
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

**核心数据管道：** 文件变更（chokidar）→ Tree-sitter 解析（AST + 符号）→ SQLite 索引 + ZVec 嵌入 → 压缩后的 MCP 响应

**关键设计决策：**
- **无 LSP 依赖**——Tree-sitter 提供与语言无关的解析，无需运行语言服务器
- **内容哈希增量索引**——仅当文件 SHA-256 发生变化时才重新解析
- **响应级压缩**——原始数据保持完整；压缩在响应边界处应用
- **每个项目一个 SQLite 数据库**——即使在 monorepo 中，所有包共享一个存储，通过 `file_path` 隔离

完整的架构文档（包括模块依赖关系、存储模式和线程池设计）请参阅 **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**。

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

### 性能目标

| 基准项 | 目标 |
|---|---|
| 索引吞吐量 | ≥ 500 文件/秒 |
| `find_symbol`（精确） | < 1ms |
| `find_symbol`（模糊） | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |
| 内存（索引后） | < 350MB |

完整的贡献指南（包括如何添加新语言）请参阅 **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**。

---

## 系统要求

| 资源 | 最低要求 |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **内存（空闲）** | ~100 MB |
| **内存（负载下）** | ~350 MB |
| **磁盘** | ~80 MB（一次性嵌入模型下载） |
| **网络** | 仅首次 `npm install` 时需要；运行时无网络调用 |

嵌入模型（`all-MiniLM-L6-v2`）在首次使用时下载，并无限期缓存在 Transformers.js 缓存目录中。

---

## 文档

| 文档 | 内容 |
|---|---|
| [README.md](../../README.md) | 项目概述、安装和配置（本文件） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 完整架构：数据流、模块图、存储模式、线程池设计 |
| [docs/TOOLS.md](./docs/TOOLS.md) | 全部 11 个工具的完整输入/输出模式及示例 |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | 开发环境搭建、测试指南、语言配置编写、PR 检查清单 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本历史与变更记录 |

---

## 许可证

[MIT](./LICENSE) — Copyright (c) 2026 Minh Do
