# Hesman MCP Server

[![CI](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **表示言語:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [**日本語**](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** は、AIコーディングエージェントにコードベースの深い理解（シンボル、コールグラフ、依存関係、セマンティック検索）を提供する次世代MCP（Model Context Protocol）サーバーです。3層の圧縮パイプラインにより、トークン消費を劇的に削減します（最良のケースで最大97%）。すべてローカルで動作し、外部APIやLSPサーバーは不要です。

---

## 目次

- [なぜHesmanなのか？](#なぜhesmanなのか)
- [クイックスタート](#クイックスタート)
- [機能](#機能)
- [トークン削減の仕組み](#トークン削減の仕組み)
- [インストールとセットアップ](#インストールとセットアップ)
- [ツールリファレンス](#ツールリファレンス)
- [設定](#設定)
- [CLIリファレンス](#cliリファレンス)
- [対応言語](#対応言語)
- [アーキテクチャ](#アーキテクチャ)
- [開発環境のセットアップ](#開発環境のセットアップ)
- [要件](#要件)
- [ドキュメント](#ドキュメント)
- [ライセンス](#ライセンス)

---

## なぜHesmanなのか？

AIコーディングエージェントは強力ですが、コストがかかります。エージェントが読み取るコードの1行1行がトークンを消費します。エージェントが必要とするのは1つの関数だけなのに、ファイル全体を送信することは、コンテキストとコストの無駄です。

Hesmanは次の方法でこの問題を解決します：

- **エージェントが必要とするものだけを提供** — 注目すべき関数、その呼び出し元、呼び出し先、または変更によって影響を受けるシンボルのみを返します。
- **すべてのレスポンスを圧縮** — 3層パイプラインでコメントを除去し、無関係なコードを刈り込み、大きな結果セットを要約します。
- **生のダンプを要約に置き換え** — 200件の参照をJSON配列で返す代わりに、種類やファイルごとにグループ化されたカウントを含む `_summary` ブロックをエージェントに提供します。
- **100%ローカルで実行** — APIキー不要、ネットワーク呼び出し不要、外部サービスによるレイテンシーもなし。コードがマシンを離れることはありません。
- **削減量を測定可能** — すべてのレスポンスに `_meta.reduction` が含まれ、生出力と比較して正確に何トークン節約されたかを示します。

結果として、エージェントはより速く動作し、コストが削減され、正しいコードだけを見るためより正確に推論できるようになります。

---

## クイックスタート

```bash
# 1. グローバルにインストール
npm install -g hesman-mcp

# 2. プロジェクト内でサーバーを実行
cd my-project
hesman

# 3. AIエージェントに登録（Claude Desktop、Cursor、VS Code）
hesman install --agent claude
```

これだけです。初期インデックス作成が完了すれば（ほとんどのプロジェクトで数秒）、AIエージェントはHesmanの11のツールを通じてコードベースをクエリできるようになります。

---

## 機能

### コードインテリジェンス

| 機能 | 説明 |
|---|---|
| **シンボル検索** | 関数、クラス、メソッドを名前で検索 — 完全一致、あいまい検索、前方一致（1ms未満） |
| **コールグラフ探索** | 最大3階層までの呼び出し元と呼び出し先を辿る |
| **参照追跡** | コードベース全体でのシンボルのすべての使用箇所を検索 |
| **影響分析** | シンボルの名前変更、削除、シグネチャ変更時に何が壊れるかを確認 |
| **セマンティック検索** | 自然言語で探しているものを記述し、一致するコードを見つける |
| **構造検索** | `console.$METHOD($$$ARGS)` のような名前付きキャプチャによるコードパターンの検索 |
| **依存関係分析** | ファイルが何をインポートしているか、何がそのファイルをインポートしているかを表示 |
| **コンテキストウィンドウ** | ファイル内の任意の位置を中心に、焦点を絞って圧縮されたコードを取得 |

### トークン削減パイプライン

Hesmanの3層圧縮パイプラインは、すべてのレスポンスでトークン使用量を削減します。実際の削減量は測定され、各レスポンスの `_meta.reduction` を通じて報告されます。

| 層 | 手法 | 標準的な削減率 | 最良のケース |
|---|---|---|---|
| **コンパクトモード** | コメント、空行、末尾の空白を除去。未使用のインポートを削除 | 10–30% | ~35%（コメントが多いコード） |
| **コンテキストプルーニング** | クエリしたシンボルに関連する行のみを保持。省略したコードはカウントマーカーに置き換え | 50–80%（コンパクトモードに加えて） | ~95%（広いファイルで小さなフォーカス領域） |
| **スマート要約** | 大きな結果配列を集約された `_summary` ブロックに置き換え。呼び出しチェーンをグループ化された統計に圧縮 | 15–85%（200件以上のリストツールにおいて） | ~90%（200件以上の参照を要約） |

**組み合わせた最良のケース:** `get_context` で単一の関数をクエリした430行のファイル → 約6行の関連行にプルーニング + コンパクトモード → **最大97%削減**。これは理想的なシナリオです。全ツールでの標準的な使用では、平均20～70%の削減となります。

### プロダクション対応

- **ワーカープール** — CPUコア全体で並列インデックス作成、デフォルトで自動サイズ設定
- **ファイル監視** — chokidarによるファイル変更時のインクリメンタル再インデックス作成
- **グレースフルシャットダウン** — アクティブな作業を完了し、ストアをフラッシュし、ワーカーを正常に終了
- **コンテンツハッシュインデックス** — コンテンツが実際に変更された場合のみファイルを再パース
- **モノレポ対応** — pnpm、lerna、nx、turbo、npm workspacesを自動検出
- **診断** — `hesman diag` でメモリ、ストア統計、プール状態、キャッシュメトリクスを表示
- **CIテスト済み** — Ubuntu、macOS、WindowsでNode 20および22で動作確認済み

---

## トークン削減の仕組み

### 第1層: コンパクトモード

コメント、空行、末尾の空白を除去しつつ、マジックコメント（`// @ts-ignore`、`// eslint-disable-*`）は保持します。レベル2では、AST認識によるJSDocの処理と未使用インポートの削除を追加します。

Before:
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

After (Level 1):
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

After (Level 2 — AST認識、JSDocのみ保持):
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

### 第2層: コンテキストプルーニング

エージェントが特定のシンボルに対して `get_context` をクエリすると、Hesmanは関連するコードのみを返します：

```typescript
// ... (45 lines omitted: unrelated imports and helper functions)

/**
 * Processes the incoming webhook payload.
 */
export async function handleWebhook(payload: WebhookPayload): Promise<Result> {
  // ... (function body)
}

// ... (120 lines omitted: unrelated class definitions)
```

プルーニングで保持するもの：フォーカスシンボルの定義、そのドキュメントコメント、同じファイル内の直接の呼び出し元と呼び出し先、ファイル内参照 — それ以外はすべてカウントマーカーに置き換えられます。

### 第3層: スマート要約

200件の参照をJSON配列でダンプする代わりに：

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

エージェントはその後、特定のファイルや種類の詳細を `cursor` によるページネーションで要求できます。

### 削減量の測定

すべてのHesmanレスポンスには、実際のトークン削減量を示す `_meta` ブロックが含まれます：

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

これにより、実際のワークロードでHesmanがどれだけ節約しているかを正確に監査できます。

---

## インストールとセットアップ

### 前提条件

- **Node.js** ≥ 20.0.0
- **npm**（または pnpm / yarn）

### npmからのインストール

```bash
npm install -g hesman-mcp
```

### ソースからのインストール

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Tree-sitter WASMパーサーをダウンロード
npm run build              # TypeScriptをコンパイル
npm link                   # `hesman` をグローバルに利用可能にする
```

### AIエージェントへの登録

```bash
# Claude Desktop（プラットフォームに応じて設定ファイルのパスを自動検出）
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code（CopilotまたはClineを使用）
hesman install --agent vscode

# --global を指定すると、プロジェクトレベルではなくユーザーレベルの設定に書き込む
hesman install --agent claude --global
```

インストール後、AIエージェントを再起動すると、HesmanがMCPサーバーとして利用可能になります。

### 手動MCP設定

エージェントのMCP設定ファイルに以下を追加します：

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

## ツールリファレンス

Hesmanは、MCP stdioトランスポート上で **11のツール** を公開します。すべてのレスポンスには、トークン削減量を示す `_meta` ブロックと、該当する場合は結果を集約した `_summary` ブロックが含まれます。

### コードナビゲーション

| ツール | 説明 | 主な入力 |
|---|---|---|
| `find_symbol` | 完全一致、あいまい検索、前方一致で名前からシンボルを検索 | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | ファイル内の全シンボルの階層ツリーを取得 | `filePath`, `includeNested` |
| `get_references` | コードベース全体でのシンボルの全使用箇所を検索 | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | 特定の位置を中心に圧縮されたコードを取得 | `filePath`, `startLine`, `contextLines`, `mode` |

### コールグラフ

| ツール | 説明 | 主な入力 |
|---|---|---|
| `get_callers` | 特定のシンボルを呼び出す全関数を検索（最大3階層） | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | 特定のシンボルが呼び出す全関数を検索（最大3階層） | `symbolId`, `maxDepth`, `topK` |

### 分析

| ツール | 説明 | 主な入力 |
|---|---|---|
| `impact_analysis` | シンボル変更時に何が壊れるかを分類（名前変更/削除/シグネチャ変更） | `symbolId`, `changeType` |
| `list_dependencies` | ファイルがインポートしているもの、またはそのファイルをインポートしているものを表示 | `filePath`, `direction` |
| `semantic_search` | 自然言語の説明でコードを検索 | `query`, `topK`, `language`, `kind` |
| `find_pattern` | `$NAME`、`$$$ARGS` などの名前付きキャプチャによる構造パターン検索 | `pattern`, `language`, `topK` |

### ステータス

| ツール | 説明 |
|---|---|
| `index_status` | インデックス作成の健全性を報告：ファイル数、シンボル数、ストア状態、保留中のファイル |

完全な入出力スキーマと使用例については、**[docs/TOOLS.md](./docs/TOOLS.md)** を参照してください。

---

## 設定

プロジェクトルートに `hesman.config.json` を作成します（すべてのフィールドはオプションです）：

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

### 設定の優先順位

設定は次の順序で解決されます（後続が先行を上書きします）：

1. **デフォルト値** — Hesmanに組み込み
2. **`hesman.config.json`** — プロジェクトレベルの設定ファイル
3. **環境変数** — 例: `HESMAN_WORKERS=4`
4. **CLIフラグ** — 例: `--workers 4`

### 環境変数

| 変数 | 同等のCLIフラグ | 説明 |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | インデックス対象のプロジェクトへのパス |
| `HESMAN_WORKERS` | `--workers N` | ワーカースレッド数（0 = 自動検出） |
| `HESMAN_LOG_LEVEL` | `--log-level` | 次のいずれか: trace、debug、info、warn、error |
| `HESMAN_DATA_DIR` | `--data-dir` | インデックスデータ用ディレクトリ（デフォルト: `.hesman`） |
| `HESMAN_WATCH_MODE` | `--watch-mode` | ファイル監視の有効/無効（true/false） |

### CLIフラグ

| フラグ | 説明 |
|---|---|
| `--project-root <path>` | プロジェクトルートディレクトリ |
| `--workers <N>` | ワーカースレッド数（0 = 自動） |
| `--log-level <level>` | ログレベル |
| `--data-dir <path>` | データディレクトリのパス |
| `--watch-mode` | ファイル監視を有効化 |
| `--no-watch` | ファイル監視を無効化 |
| `--no-semantic` | セマンティック検索を無効化 |
| `--batch-size <N>` | インデックス作成バッチあたりのファイル数 |

---

## CLIリファレンス

```
hesman                         MCPサーバーをstdioで実行（デフォルト）
hesman index [path]            サーバーを起動せずにプロジェクトをインデックス作成
hesman status [path]           インデックス作成の進捗と統計を表示
hesman clean [path]            .hesman/ データディレクトリを削除
hesman clean --force           確認プロンプトをスキップ
hesman clean --dry-run         削除せずに削除対象をプレビュー
hesman diag [path]             診断情報を表示：メモリ、ストア統計、プール、キャッシュ
hesman diag --json             診断情報をJSONで出力
hesman install --agent <name>  Claude Desktop、Cursor、VS Code用のMCP設定を書き込み
hesman install --global        プロジェクトレベルではなくユーザーレベルの設定に書き込み
hesman --version, -v           バージョン番号を表示
hesman --help, -h              ヘルプテキストを表示
```

---

## 対応言語

| 言語 | 拡張子 | ステータス |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | 完全対応 |
| Python | `.py`, `.pyw`, `.pyi` | 完全対応 |
| Go | `.go` | 完全対応 |

アーキテクチャはTree-sitterを通じて最大 **158言語** まで対応可能です。新しい言語を追加するには `LanguageProfile` を実装する必要があります。詳細な手順は [コントリビューティングガイド](./docs/CONTRIBUTING.md) を参照してください。

---

## アーキテクチャ

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

**コアデータパイプライン:** ファイル変更（chokidar）→ Tree-sitterパース（AST + シンボル）→ SQLiteインデックス + ZVec埋め込み → 圧縮されたMCPレスポンス

**主要な設計判断:**
- **LSP非依存** — Tree-sitterが言語サーバーを起動せずに言語に依存しないパースを提供
- **コンテンツハッシュによるインクリメンタルインデックス** — SHA-256が変更された場合のみファイルを再パース
- **レスポンスレベルでの圧縮** — 元データはそのまま保持し、レスポンス境界で圧縮を適用
- **プロジェクトごとに単一のSQLiteデータベース** — モノレポでも、すべてのパッケージが `file_path` による分離で1つのストアを共有

モジュール依存関係、ストアスキーマ、ワーカープール設計を含む完全なアーキテクチャドキュメントについては、**[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** を参照してください。

---

## 開発環境のセットアップ

### 前提条件

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### はじめに

```bash
# クローンとインストール
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Tree-sitter WASMパーサーをダウンロード
npm run download:parsers

# 開発モードで実行（ホットリロード）
npm run dev

# 本番用にビルド
npm run build
```

### コード品質

```bash
npm run typecheck    # TypeScriptの型チェック
npm run lint         # ESLint
npm run format       # Prettierによるフォーマット
```

### テストの実行

```bash
npm test                  # すべてのテストを実行（単体 + 統合）
npm run test:watch        # 開発用のウォッチモード
npm run test:e2e          # エンドツーエンドテスト（完全なサーバーを起動）
npm run test:perf         # パフォーマンスベンチマーク
```

### パフォーマンス目標

| ベンチマーク | 目標値 |
|---|---|
| インデックススループット | ≥ 500 ファイル/秒 |
| `find_symbol`（完全一致） | < 1ms |
| `find_symbol`（あいまい検索） | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |
| メモリ（インデックス後） | < 350MB |

新しい言語の追加方法を含む完全なコントリビューティングガイドについては、**[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)** を参照してください。

---

## 要件

| リソース | 最小要件 |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **メモリ（アイドル時）** | ~100 MB |
| **メモリ（負荷時）** | ~350 MB |
| **ディスク** | ~80 MB（埋め込みモデルの初回ダウンロード） |
| **ネットワーク** | 初回 `npm install` のみ。実行時のネットワーク呼び出しはゼロ |

埋め込みモデル（`all-MiniLM-L6-v2`）は初回使用時にダウンロードされ、Transformers.jsのキャッシュディレクトリに無期限でキャッシュされます。

---

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [README.md](../../README.md) | プロジェクト概要、セットアップ、設定（このファイル） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 完全なアーキテクチャ：データフロー、モジュールマップ、ストアスキーマ、ワーカープール設計 |
| [docs/TOOLS.md](./docs/TOOLS.md) | 全11ツールの完全な入出力スキーマと使用例 |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | 開発環境セットアップ、テストガイド、言語プロファイル作成、PRチェックリスト |
| [CHANGELOG.md](./CHANGELOG.md) | バージョン履歴と変更点 |

---

## ライセンス

[MIT](./LICENSE) — Copyright (c) 2026 Minh Do
