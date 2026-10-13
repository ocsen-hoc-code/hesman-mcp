# Hesman MCP Server

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

🌐 **表示言語:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | **日本語** | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** は、AIコーディングエージェントにコードベースの深い理解（シンボル、コールグラフ、依存関係、セマンティック検索）を提供する次世代MCP（Model Context Protocol）サーバーです。回答は少ないトークンで済むように形作られています。このリポジトリでは、`get_context` が返すトークンはファイル全体より80–96%少なく、呼び出し元や参照のリストは素のJSONより66–72%小さくなります（[このリポジトリでの計測](#このリポジトリでの計測)を参照）。すべてお使いのマシン上で動作します：外部APIなし、LSPサーバーなし、コードが外部に送信されることもありません。

---

## 目次

- [なぜHesmanなのか？](#なぜhesmanなのか)
- [クイックスタート](#クイックスタート)
- [機能](#機能)
- [トークン削減の仕組み](#トークン削減の仕組み)
- [インストールとセットアップ](#インストールとセットアップ)
- [ダッシュボード](#ダッシュボード)
- [アンインストール](#アンインストール)
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

AIコーディングエージェントは強力ですが、コストがかかります。エージェントが読むコードは1行ごとにトークンを消費します。必要なのは1つの関数だけなのにファイル全体を送るのは、コンテキストと費用の無駄です。

Hesmanは次の方法でこの問題を解決します：

- **エージェントが必要とするものだけを提供** — 対象の関数、その呼び出し元、呼び出し先、または変更の影響を受けるシンボル。
- **コードの圧縮とプルーニング** — `get_context` はコメントと空行を取り除き、ファイル全体ではなくフォーカス位置の周辺の行だけを返します。
- **コンパクトなリスト** — 呼び出し元、呼び出し先、参照、シンボル、ファイルのアウトラインは、名前付きの列の下に行として返され、ファイルごとにまとめられ、パスはプロジェクトからの相対パスになります。どの行も省略されません。レスポンスが素のペイロードより大きくなることはありません（[トークン削減パイプライン](#トークン削減パイプライン)を参照）。
- **あなたのマシン上で実行** — APIキー不要、外部サービスなし、それによるレイテンシーもなし。コードがマシンの外に出ることはありません。ダウンロードが発生するのは、初回使用時の埋め込みモデルとオンデマンド言語の文法だけで、どちらも無効にできます（`--no-semantic`、`HESMAN_GRAMMARS_OFFLINE=1`）。
- **削減量を測定可能** — `index_status` を除くすべてのツールレスポンスに `_meta.reduction` が含まれ、生の出力と比べて何トークン節約できたかを正確に示します。

その結果、エージェントはより速く動作し、コストは下がり、すべてのコードではなく正しいコードを見るため、より正確に推論できます。

---

## クイックスタート

`hesman-mcp` はまだnpmレジストリに公開されていないため、現時点ではHesmanをソースからインストールします：

```bash
# 1. Hesmanを取得してビルド（Node.js ≥ 20）
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers
npm run build

# 2. AIクライアントに登録（Claude Code、Cursor、VS Code、Codex などを検出）
node dist/index.js setup
```

クライアントを再起動してプロジェクトを開きます。`setup` は、Hesmanのインストール方法に合った起動コマンドを書き込みます（ここでは `node` と `dist/index.js` への絶対パスなので、PATHに何も通す必要はありません）。[起動コマンド](#起動コマンド)を参照してください。

パッケージが公開された後は、クイックスタート全体が1行になります：

```bash
npx -y hesman-mcp setup   # hesman-mcp がnpmに公開されてからのみ
```

サーバーはエージェントに即座に応答し、バックグラウンドでインデックスを作成します（ほとんどのプロジェクトで数秒）。11のツールはすぐに使え、インデックスがまだ完成していない間は結果に `_meta.indexing` を付け、`index_status` が進捗を報告します。

---

## 機能

### コードインテリジェンス

| 機能 | 説明 |
|---|---|
| **シンボル検索** | 関数、クラス、メソッドを名前で検索 — 完全一致、あいまい一致、前方一致（1ms未満） |
| **コールグラフ探索** | 呼び出し元と呼び出し先を最大3階層までたどる |
| **参照追跡** | コードベース全体でシンボルのすべての使用箇所を検索 |
| **影響分析** | シンボルの名前変更、削除、シグネチャ変更で何が壊れるかを確認 |
| **セマンティック検索** | 探しているものを自然言語で記述し、一致するコードを見つける |
| **構造検索** | `console.$METHOD($$$ARGS)` のような名前付きキャプチャを使ったコードパターンを検索 |
| **依存関係分析** | ファイルが何をインポートしているか、何がそのファイルをインポートしているかを確認 |
| **コンテキストウィンドウ** | ファイル内の任意の位置の周辺について、焦点を絞って圧縮したコードを取得 |

### トークン削減パイプライン

Hesmanはトークンを3つの方法で削減します。すべてのレスポンスは実際の削減量を `_meta.reduction` で報告し、レスポンスが素のペイロードより大きくなることはありません。

| 層 | 手法 | 実測の削減率 | 適用対象 |
|---|---|---|---|
| **コンパクトモード** | コメント、空行、末尾の空白を除去 | コード抜粋の0–16%（含まれるコメントと空行の量によって異なる）（`mode: "full"` と `"compact"` の比較） | `get_context` |
| **コンテキストプルーニング** | ファイル全体ではなく、フォーカス位置の周辺の行範囲を返す | デフォルトの±5行で96.0%、±40行で79.7%（514行のファイル）。ファイル全体を要求した場合は0% | `get_context` |
| **コンパクトなリスト** | 名前付きの列の下の行、ファイルごとにまとめ、プロジェクトからの相対パス | 呼び出し元、呼び出し先、参照は66–72%。シンボルのリスト、ファイルのアウトライン、依存関係、影響分析は35–41% | `find_symbol`, `get_references`, `get_callers`, `get_callees`, `get_file_structure`, `list_dependencies`, `impact_analysis` |

`find_pattern` と `semantic_search` は、素のペイロード（`_meta.reduction: "0.0%"`）を返します。数値はこのリポジトリのものです。完全な表と再現方法は[このリポジトリでの計測](#このリポジトリでの計測)を参照してください。各レスポンスの `_meta.reduction` フィールドが、あなたのワークロードでの正確な削減量を報告します。

### プロダクション対応

- **ワーカープール** — CPUコアをまたいだ並列インデックス作成。デフォルトで自動的にサイズを決定
- **ファイル監視** — chokidarによる、ファイル変更時のインクリメンタルな再インデックス
- **グレースフルシャットダウン** — 実行中の作業を完了させ、ストアをフラッシュし、ワーカーを正常に終了
- **コンテンツハッシュによるインデックス** — 内容が実際に変わった場合にのみファイルを再パース
- **モノレポ対応** — pnpm、lerna、nx、turbo、npm workspacesを自動検出
- **診断** — `hesman diag` がメモリ、ストア統計、プールの状態、キャッシュのメトリクスを表示
- **ローカルでテスト済み** — 実際のサーバーを通したエンドツーエンドテストを含むテストスイート全体がmacOS上で実行されています。LinuxとWindowsはまだ検証されていません

---

## トークン削減の仕組み

### 第1層: コンパクトモード

コメント、空行、末尾の空白を除去しつつ、マジックコメント（`// @ts-ignore`、`// eslint-disable-*`）は保持します。

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

After:
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

### 第2層: コンテキストプルーニング

`get_context` はファイル全体を返しません。要求された行範囲に、その上下それぞれ `contextLines` 行（デフォルト5、最大200）を加えて返し、その抜粋にコンパクトモードを適用します。`_meta.reduction` は結果をファイル全体と比較し、`_meta.layers` は適用されたもの（`compact`、`prune`）を列挙します。

プルーニングは行範囲だけで行われ、呼び出し元や呼び出し先をたどることはありません。ある関数が何を呼び出すか、または何がその関数を呼び出すかを読むには、`get_callees` / `get_callers` に位置を問い合わせ、それぞれについて `get_context` を呼び出してください。

### 第3層: コンパクトなリスト

リストの回答では、どの行にも同じものが繰り返し現れます。長いファイルパス、フィールド名、そして決して変わらない値です。コンパクトな形式では、それぞれを一度だけ書きます。フィールド名は `columns` に、パスはファイルごとに一度だけ、プロジェクトからの相対パスで書きます。以下は実際の `get_callers` の回答です。

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

どの行も省略されず、何も要約によって失われません。`symbolId`、相対パスの `file`、`line` は、そのまま他のツールに渡せます。`get_file_structure` と `list_dependencies` は、フラットな `rows` のリストを1つ使います。コンパクトな形式がより小さくならない場合（空のリスト、1行だけの場合）は、素のペイロードが返されます。これらのツールに `format: "full"` を渡すと、絶対パスを持つ素のオブジェクトが返されます。長いリストは `topK` で、`get_references` の場合は `cursor` を使ってページ単位で取得します。

### 削減量の測定

`index_status` を除くすべてのツールレスポンスには、実際のトークン削減量を示す `_meta` ブロックが含まれます：

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

この例は、514行のファイルに対する実際の `get_context` 呼び出し（デフォルトの±5行、コンパクトモード）です。抜粋はすでにツール側で圧縮されているため `prune` 層だけが列挙され、`compressed: false` はレスポンスコンプレッサーがそれ以上取り除くものがなかったことを意味します。`_meta.reduction` フィールドは元のファイル全体のトークン数を基準に測定するので、エンドツーエンドの真の削減量が分かります。小さくならないレスポンスは `reduction: "0.0%"` とともにそのまま返され、この値が負になることはありません。任意のツールレスポンスの `_meta.reduction` を確認すれば、実際のワークロードでHesmanがどれだけ節約しているかを正確に監査できます。

---

## インストールとセットアップ

### 前提条件

- **Node.js** ≥ 20.0.0
- **npm**（または pnpm / yarn）

### ソースからのインストール

現時点で使えるのはこの方法です。

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Tree-sitter WASMパーサーをダウンロード
npm run build              # TypeScriptをコンパイル
npm link                   # 任意: `hesman` をPATHで使えるようにする
```

`npm link` を実行しない場合は、このREADMEで `hesman` と書かれている箇所で `node /path/to/hesman-mcp/dist/index.js` を使ってください。

### npmからのインストール（パッケージの公開後）

`hesman-mcp` はまだnpmレジストリに公開されていません。公開された後は次のとおりです：

```bash
npx -y hesman-mcp setup     # インストール不要: クライアントはnpx経由でHesmanを起動する
npm install -g hesman-mcp   # または、`hesman` をPATHに置くグローバルインストール
```

### AIエージェントへの登録

```bash
hesman setup                         # このマシンで見つかったクライアントのチェックリスト
hesman setup --yes                   # 質問なし: 検出されたすべてのクライアントを設定
hesman setup --client cursor vscode  # 特定のクライアントを設定
hesman setup --dry-run --all         # クライアントごとの正確な変更内容を表示し、何も書き込まない
hesman remove                        # 元に戻す: すべてのクライアントからHesmanを取り除く
```

| クライアント | `--client` | `hesman setup` が変更するもの（ユーザースコープ） | `--scope project` |
|---|---|---|---|
| Claude Code | `claude-code` | `claude mcp add --scope user hesman -- <launch command>` を実行。CLIがない場合は `~/.claude.json` を編集 | `.mcp.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` | — |
| OpenAI Codex CLI | `codex` | `codex mcp add hesman -- <launch command>` を実行。CLIがない場合は `~/.codex/config.toml` を編集 | `.codex/config.toml` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Google Antigravity | `antigravity` | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| VS Code (Copilot) | `vscode` | VS Codeのユーザーディレクトリにある `mcp.json` | `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Windsurf | `windsurf` | `~/.config/devin/mcp_config.json` | — |

- 変更されるのは `hesman` エントリだけです。変更されるファイルはまず `<file>.hesman.bak` にコピーされ、その間にほかの変更がなければ、`hesman remove` がバイト単位で元どおりに復元します。
- エントリにはプロジェクトのパスが含まれません。Hesmanが自分でプロジェクトを見つけます（後述）。例外は2つです。**Claude Desktop** にはワークスペースがないため、そのエントリは1つのプロジェクト（カレントディレクトリ、または `--project-root <path>`）を固定します。**Cursor** は、プロジェクトスコープの場合にのみ `--project-root ${workspaceFolder}` が付きます（グローバルの `~/.cursor/mcp.json` ではこの変数がホームディレクトリになることがあるため、グローバルのエントリはプロジェクトを指定しません）。
- **Antigravity** と **Windsurf** については、プロジェクトがサーバーにどう渡されるかがドキュメント化されていません。`hesman setup` は、初回起動後に確認するよう求める注記を表示します。
- コメント付きの設定ファイル（JSONC）は編集されません。`hesman setup` はそれらを報告し、手を付けずに残します。
- `hesman install --agent <name>` は、`hesman setup --client <name> --yes` の非推奨エイリアスとして引き続き動作します。

セットアップ後にクライアントを再起動すると、HesmanがMCPサーバーとして利用できるようになります。

### エージェント利用ルール（オプトイン）

MCPサーバーをインストールしても、自動的に使われるようになるわけではありません。エージェントはgrepやファイル全体の読み取りに頼り続けることがよくあります。`hesman setup --rules` は、選択した各クライアントが **現在のプロジェクト** で読む指示ファイルにも短いブロック（14行）を書き込み、どの質問にどのHesmanツールが答えるかを伝えます。これによってエージェントがツールを呼び出す頻度が変わるかどうかは、まだ測定されていません。

```bash
hesman setup --client claude-code codex --rules   # プロジェクト内で実行
hesman setup --all --rules --dry-run              # ブロックと対象ファイルを表示し、何も書き込まない
hesman remove                                     # ブロックも再び削除する
```

| クライアント | 指示ファイル（プロジェクトからの相対パス） |
|---|---|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex CLI, Windsurf | `AGENTS.md` |
| Gemini CLI, Google Antigravity | `GEMINI.md` |
| Cursor | `.cursor/rules/hesman.mdc`（専用のルールファイル、`alwaysApply: true`） |
| VS Code (Copilot) | `.github/copilot-instructions.md` |
| Claude Desktop | なし: プロジェクトのファイルを読まないため、注記を出してスキップされる |

- **オプトイン。** `--rules` がなければ何も書き込まれません。ターミナルで `--yes` なしの場合、setupは一度だけ確認し、デフォルトの答えは「いいえ」です。
- ブロックは `<!-- hesman:rules:start -->` と `<!-- hesman:rules:end -->` の間に置かれます。setupをもう一度実行するとその場で置き換えられます。マーカーの外のテキストは決して変更されず、2つのクライアントが共有するファイルにはブロックが1回だけ書き込まれます。
- `hesman remove` はそのブロックだけを削除し、ファイルをバイト単位で元どおりに戻します。Hesmanが作成し、ほかに何も含まないファイルは削除されます。同じプロジェクト内で実行してください（または `--project-root <path>` を渡します。これは `setup --rules` でも受け付けます）。
- これらのファイルは通常gitにコミットされ、チームで共有されます。setupは変更したファイルを一覧表示するので、内容を確認（`git diff`）してコミットするかどうかを決められます。

### 起動コマンド

`hesman setup --command auto|npx|global|absolute` は、クライアントが何を実行するかを決めます。setupがネットワークを使うことはありません。

| `--command` | 書き込まれるエントリ | 必要なもの |
|---|---|---|
| `npx` | `npx -y hesman-mcp@<major>` | npm上のパッケージ（まだ公開されていません）と、クライアントのPATH上の `npx`。Nodeをアップグレードしても動作し続ける |
| `global` | `hesman` | クライアントのPATH上にあるグローバルインストール（または `npm link`） |
| `absolute` | `/path/to/node /path/to/hesman-mcp/dist/index.js` | PATH上には何も不要。Nodeのバージョンを切り替えたりHesmanを移動したりした後は `hesman setup` を再実行する |

`auto`（デフォルト）は、実行中のHesmanがどのように起動されたかを調べます：

1. `npx` 経由で起動された（`_npx` キャッシュディレクトリから実行されている）→ `npx`
2. PATH上の `hesman` がこの同じインストールである（シンボリックリンクは解決済み）→ `global`
3. それ以外（ソースのチェックアウト、ローカルの `node_modules`、PATH上にない）→ `absolute`

Dockやランチャーから開いたデスクトップアプリ（Claude Desktop、Cursor、Antigravity、VS Code、Windsurf）は、シェルのPATHを受け取りません。macOSとLinuxでは、`auto` が `npx` または `hesman` を選び、そのコマンドまたは `node` が標準のシステムディレクトリ（`/usr/bin`、`/bin`、`/usr/sbin`、`/sbin`、`/usr/local/bin`、加えてmacOSでは `/opt/homebrew/bin`、Linuxでは `/snap/bin`）にない場合 — nvm、fnm、volta、asdfでは通常そうなります — これらのクライアントには代わりに `absolute` エントリが書き込まれ、Nodeのバージョンを切り替えた後に `hesman setup` を再実行するよう求める注記が付きます。ターミナルクライアント（Claude Code、Codex CLI、Gemini CLI）はシェルを引き継ぐので、選ばれたコマンドをそのまま使います。明示的な `--command npx|global` は、すべてのクライアントに指定どおり書き込まれ、デスクトップアプリがそれを見つけられない可能性がある場合は警告が出ます。

### 手動MCP設定

エージェントのMCP設定ファイルに以下を追加します（VS Codeは `"mcpServers"` の代わりに `"servers"` を使い、エントリに `"type": "stdio"` が必要です。Codexは `[mcp_servers.hesman]` というTOMLテーブルを使います）：

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

`--project-root` は省略可能です（後述）。`"command": "hesman"` には、クライアントから見えるPATH上に `hesman` が必要です。そうでない場合は `"command": "/path/to/node"` を使い、最初の引数として `"/path/to/hesman-mcp/dist/index.js"` を指定します（[起動コマンド](#起動コマンド)を参照）。

### Hesmanがプロジェクトを選ぶ方法

1つのサーバープロセスが1つのプロジェクトをインデックスします。プロジェクトは次の順序で選ばれます：

1. **明示的なルート** — `--project-root <path>`、`HESMAN_PROJECT_ROOT`、または `hesman.config.json` の `projectRoot`。常に優先されます。
2. **MCPクライアントのワークスペースフォルダ** — クライアントがMCPの `roots` ケイパビリティをサポートしている場合、Hesmanはハンドシェイクの後にフォルダを問い合わせ、最初の1つをインデックスします（ほかのフォルダはログに記録されるだけで、インデックスされません）。クライアントが後で別のフォルダを報告すると、Hesmanはそちらに切り替えます。
3. **作業ディレクトリ** — サーバーの作業ディレクトリ、またはその上位にあるディレクトリのうち、バージョン管理ディレクトリ（`.git`、`.hg`、`.svn`、`.jj`）またはプロジェクトのマニフェスト（`package.json`、`go.mod`、`pyproject.toml`、`Cargo.toml` など）を持つ最も近いもの。
4. **プロジェクトなし** — サーバーは起動してツールの一覧も返しますが、すべてのツールが、ルートの設定方法を説明する `NO_PROJECT` エラーを返します。

ホームディレクトリとその親ディレクトリが自動的に選ばれることはありません（手順2と3）。そのため、`~` から起動されたグローバルなMCPエントリがディスク全体を走査することはありません。インデックスは、選ばれたプロジェクト内の `.hesman/` に保存されます。

## ダッシュボード

`hesman ui` は、1つのプロジェクトについてローカルのWebページを開きます。エージェントがHesmanに何を尋ねたか、どれだけ速く応答したか、どれだけのトークンを節約したか、サーバーが何を記録したか、そしてインデックスに何が入っているかを表示します。

```bash
cd /path/to/project
hesman ui                 # 空いているポート。ブラウザを開く
hesman ui --no-open       # URLを表示するだけ
hesman ui --port 4100     # ポートを固定
```

プロジェクトにはインデックスが必要です（MCPサーバーを一度起動するか、`hesman index` を実行してください）。コマンドは `http://127.0.0.1:<port>/?token=<random>` という形式のURLを表示します。Ctrl+C で停止します。

![メトリクス：呼び出し、失敗、遅延、トークン（削減前後）](../images/dashboard-metrics.png)

| 画面 | 表示内容 |
|---|---|
| **Overview** | インデックスの状態、ファイル、シンボルと関係、言語ごとのサポートティア、およびダッシュボードで利用できないもの |
| **Metrics** | MCPサーバーが記録したツール呼び出し：件数、失敗、中央値と95パーセンタイルの遅延、削減前後のトークン。時間別とツール別、直近の呼び出しを含む |
| **Logs** | サーバーのログ。新しいものが先頭。レベルとテキストで絞り込め、リアルタイムで更新される |
| **Graph** | シンボルを検索して呼び出し元と呼び出し先をグラフで表示、またはファイル同士のインポート関係を表示。ノードを選択すると隣接ノードを読み込む |
| **Playground** | ツールを選び、フォームで引数を入力して実行し、エージェントが受け取る正確な回答とそのトークン数を表示 |

![グラフ：シンボルとその呼び出し元・呼び出し先](../images/dashboard-graph.png)

注意事項：

- **メトリクスとログは、MCPサーバーが記録した内容を表示します。** エージェントがそのプロジェクトでHesmanを呼び出すまでは空です。`hesman index` だけでは呼び出しは記録されません。
- **MCPサーバーと並んで動作します。** ダッシュボードは独立したプロセスで、インデックスを読み取り専用で開くため、両方を同時に実行できます。
- **ローカルのみ。** `127.0.0.1` で待ち受け、すべてのリクエストにはURLのトークンが必要です。トークンは起動のたびに変わります。どこにも何も送信されません。
- **2つの制限。** Playgroundから `semantic_search` は実行できません（ベクトルストアは1プロセスしか許可せず、MCPサーバーがそれを保持しているため）。また、ダッシュボードはインデックスを保存された状態で表示し、実行中の処理は表示しません。

全オプションとHTTP APIは [docs/CLI.md](../CLI.md#hesman-ui) に、アクセスルールは [docs/SECURITY.md](../SECURITY.md) にあります。

---

## アンインストール

Hesmanはデータを4か所に保存します。最初の2つの手順では `hesman` コマンドが必要なので、この順序で削除してください。

**1. AIクライアントからHesmanを取り除く**

```bash
hesman remove --dry-run        # 削除される内容を表示。何も書き込まない
hesman remove                  # 設定のあるすべてのクライアントから hesman エントリを削除（ユーザースコープ）
hesman remove --scope project  # --scope project で設定したプロジェクト内で実行
```

`hesman remove` が削除するのは `hesman` エントリだけです。`hesman setup --rules` を使った場合は、プロジェクトの指示ファイル内の `<!-- hesman:rules:start -->` と `<!-- hesman:rules:end -->` の間のブロックも削除されます。それ以外のファイルの内容はそのまま残ります。その後、クライアントを再起動してください。クライアントの設定ファイルの横にある `<config>.hesman.bak` ファイルは、Hesmanが最後に編集する前に作成したバックアップです。不要になったら削除してください。

**2. 各プロジェクトのインデックスを削除する**

```bash
cd /path/to/project
hesman clean --dry-run   # ディレクトリとそのサイズを表示
hesman clean --force     # .hesman/ を削除（インデックス、ベクトル、ログ、ツール呼び出しログ）
```

Hesmanを使用したすべてのプロジェクトで繰り返すか、プロジェクトの `.hesman/` ディレクトリを手作業で削除してください。`HESMAN_DATA_DIR` または `--data-dir` を設定している場合、データはそのディレクトリにあります。

**3. 文法のキャッシュを削除する**

オンデマンドで取得された文法は、ユーザーごとに、プロジェクトの外に保存されます。該当する最初の場所にある `hesman` ディレクトリを削除してください。

| 設定 / プラットフォーム | 削除するディレクトリ |
|---|---|
| `HESMAN_CACHE_DIR` が設定されている | `$HESMAN_CACHE_DIR/hesman` |
| `XDG_CACHE_HOME` が設定されている | `$XDG_CACHE_HOME/hesman` |
| macOS | `~/Library/Caches/hesman` |
| Windows | `%LOCALAPPDATA%\hesman` |
| Linux およびその他 | `~/.cache/hesman` |

`hesman grammars list` で正確なキャッシュディレクトリが表示されます。オンデマンドの文法を一度もダウンロードしていなければ、そのディレクトリは存在しません。

**4. プログラム本体を削除する**

```bash
# ソースからインストールした場合
npm unlink -g hesman-mcp   # `npm link` を実行した場合のみ
rm -r /path/to/hesman-mcp  # クローンしたリポジトリ

# npm からインストールした場合（パッケージが公開された後）
npm uninstall -g hesman-mcp
```

埋め込みモデルはパッケージ自身の `node_modules` 内に保存されるため、プログラムと一緒に消えます。上記の場所以外に何かが書き込まれることはありません。バックグラウンドサービスも、システム全体の設定もありません。

---

## ツールリファレンス

Hesmanは、MCP stdioトランスポート上で **11のツール** を公開します。`index_status` を除くすべてのツールレスポンスには、トークン削減量を示す `_meta` ブロックが含まれます（`impact_analysis` は、影響を受けるファイルについての独自の `_summary` も返します）。

### コードナビゲーション

| ツール | 説明 | 主な入力 |
|---|---|---|
| `find_symbol` | 完全一致、あいまい一致、前方一致で名前からシンボルを検索 | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | ファイル内の全シンボルの階層ツリーを取得 | `filePath`, `includeNested` |
| `get_references` | コードベース全体でシンボルのすべての使用箇所を検索 | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | 特定の位置の周辺の圧縮されたコードを取得 | `filePath`, `startLine`, `contextLines`, `mode` |

### コールグラフ

| ツール | 説明 | 主な入力 |
|---|---|---|
| `get_callers` | 指定したシンボルを呼び出すすべての関数を検索（最大3階層） | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | 指定したシンボルが呼び出すすべての関数を検索（最大3階層） | `symbolId`, `maxDepth`, `topK` |

### 分析

| ツール | 説明 | 主な入力 |
|---|---|---|
| `impact_analysis` | シンボルを変更した場合に何が壊れるかを分類（名前変更/削除/シグネチャ変更） | `symbolId`, `changeType` |
| `list_dependencies` | ファイルが何をインポートしているか、または何がそのファイルをインポートしているかを表示 | `filePath`, `direction` |
| `semantic_search` | 自然言語の説明でコードを検索 | `query`, `topK`, `language`, `kind` |
| `find_pattern` | 名前付きキャプチャ（`$NAME`、`$$$ARGS`）を使った構造パターンで検索 | `pattern`, `language`, `topK` |

### ステータス

| ツール | 説明 |
|---|---|
| `index_status` | インデックスの健全性を報告：ファイル数、シンボル数、ストアの状態、保留中のファイル、初回のバックグラウンドインデックスの進捗 |

例を含む完全な入出力スキーマについては、**[docs/TOOLS.md](../TOOLS.md)** を参照してください。

---

## 設定

プロジェクトルートに `hesman.config.json` を作成します（すべてのフィールドは省略可能です）：

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

> **シンボリックリンクはインデックス作成時にスキップされます。** プロジェクトスキャナーとファイルウォッチャーは、（ファイルへのものでもディレクトリへのものでも）シンボリックリンクを決してたどりません。これにより無限ループ（例: `loop -> .`）を防ぎ、プロジェクト外のコードがインデックスに入らないようにし、シンボルの重複を避けます。リンク先のコードをインデックスするには、`projectRoot` を実際のディレクトリに向けてください。

### 設定の優先順位

設定は次の順序で解決されます（後のものが前のものを上書きします）：

1. **デフォルト値** — Hesmanに組み込み
2. **`hesman.config.json`** — プロジェクトレベルの設定ファイル
3. **環境変数** — 例: `HESMAN_WORKERS=4`
4. **CLIフラグ** — 例: `--workers 4`

### 環境変数

| 変数 | 同等の指定 | 説明 |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | インデックスするプロジェクトへのパス |
| `HESMAN_WORKERS` | `--workers N` | ワーカースレッド数（0 = 自動検出） |
| `HESMAN_LOG_LEVEL` | `--log-level` | 次のいずれか: trace、debug、info、warn、error |
| `HESMAN_DATA_DIR` | `--data-dir` | インデックスデータ用のディレクトリ（デフォルト: `.hesman`） |
| `HESMAN_WATCH_MODE` | `--watch-mode` | ファイル監視の有効/無効（true/false） |
| `HESMAN_GRAMMARS_OFFLINE` | — | `1` または `true`: 文法を一切ダウンロードしない（設定キー `grammars.offline`） |
| `HESMAN_CACHE_DIR` | — | ユーザーごとの文法キャッシュを置くディレクトリ（`<dir>/hesman/grammars/`） |

### CLIフラグ

| フラグ | 説明 |
|---|---|
| `--project-root <path>` | インデックスするプロジェクト（デフォルト: 自動検出。[Hesmanがプロジェクトを選ぶ方法](#hesmanがプロジェクトを選ぶ方法)を参照） |
| `--workers <N>` | ワーカースレッド数（0 = 自動） |
| `--log-level <level>` | ログレベル |
| `--data-dir <path>` | データディレクトリのパス |
| `--watch-mode` | ファイル監視を有効化 |
| `--no-watch` | ファイル監視を無効化 |
| `--no-semantic` | セマンティック検索を無効化 |
| `--batch-size <N>` | インデックス作成のバッチあたりのファイル数 |

---

## CLIリファレンス

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

## 対応言語

| 言語 | 拡張子 | ティア | 文法（grammar） | できること |
|---|---|---|---|---|
| TypeScript | `.ts`, `.mts`, `.cts` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| TSX | `.tsx` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| JavaScript（JSXを含む） | `.js`, `.jsx`, `.mjs`, `.cjs` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Python | `.py`, `.pyw`, `.pyi` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Go | `.go` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Java | `.java` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| C | `.c`, `.h` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.ipp`, `.tpp` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| C# | `.cs`, `.csx` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Rust | `.rs` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| PHP | `.php`, `.phtml` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Ruby | `.rb`, `.rake`, `.gemspec`, `.ru`, `.podspec` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Kotlin | `.kt`, `.kts` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Swift | `.swift` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Bash | `.sh`, `.bash` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Lua | `.lua` | deep | 同梱 | シンボル、コールグラフ、影響分析 |
| Scala | `.scala`, `.sc`, `.sbt` | structural | オンデマンド | シンボルのみ（コールグラフなし） |
| OCaml | `.ml` | structural | オンデマンド | シンボルのみ（コールグラフなし） |
| F# | `.fs`, `.fsx` | structural | オンデマンド | シンボルのみ（コールグラフなし） |
| R | `.r` | structural | オンデマンド | シンボルのみ（コールグラフなし） |
| CodeQL | `.ql`, `.qll` | structural | オンデマンド | シンボルのみ（コールグラフなし） |
| Arduino | `.ino` | structural | オンデマンド | シンボルのみ（コールグラフなし） |
| Elixir | `.ex`, `.exs` | structural | オンデマンド | シンボルのみ（コールグラフなし） |
| その他すべて | 任意のテキストファイル | text | なし | `semantic_search`、`find_pattern`、`get_context` 用のテキストチャンク（シンボルなし） |

上の表は言語レジストリから生成されます（`npx tsx scripts/generate-language-matrix.ts`。表が古くなるとテストが失敗します）。*同梱*と記された文法（grammar）はパッケージに含まれているため、オフラインで動作します。

**オンデマンドの文法。** *オンデマンド*と記された文法はパッケージに含まれていません。プロジェクトにそうした言語のファイルが初めて現れると、それらのファイルはただちにテキストとしてインデックスされ、サーバーがバックグラウンドで文法をダウンロードします（文法1つあたり0.3–11.4 MB。その文法自身のGitHubリポジトリのリリースページから取得）。ダウンロードが完了すると、ファイルはシンボル付きで再インデックスされます。各文法は、同梱の `grammars.json` でURL、サイズ、sha256によって固定されています。一致しないダウンロードは破棄され、ファイルはテキストのままになります。文法はプロジェクトの外に、ユーザーごとにキャッシュされます：`HESMAN_CACHE_DIR`、なければ `XDG_CACHE_HOME`、それもなければ `~/Library/Caches`（macOS）、`%LOCALAPPDATA%`（Windows）または `~/.cache` の下の `hesman/grammars/` です。

- **ダウンロードを無効にする：** `HESMAN_GRAMMARS_OFFLINE=1` を設定するか、`hesman.config.json` に `"grammars": { "offline": true }` を指定します。この場合、Hesmanは文法のためのネットワークリクエストを一切行いません。オンデマンド言語のファイルは、文法がすでにキャッシュされていない限り text ティアにとどまります。
- **キャッシュを事前に用意する：** `hesman grammars install scala r` または `hesman grammars install --all`（46.9 MB）。ネットワークにアクセスできないマシンでは、`.wasm` ファイルをそこにコピーして `hesman grammars install --from <directory>` を実行します。`hesman grammars list` は、何が同梱され、キャッシュされ、利用可能かを表示します。[docs/CLI.md](../CLI.md#hesman-grammars) を参照してください。
- **不足しているものを確認する：** `index_status` は、言語ごとにそのティア（`deep`、`structural` または `text`）、ファイル数、および文法が同梱・キャッシュ済み・未取得のいずれであるかとその理由を一覧表示します。

`grammars.json` は、シンボル用のクエリがまだない17の文法も固定しています（Haskell、Zig、Julia、Perl、Objective-C、Odin、Luau、Starlark、HTML、CSS、JSON、YAML、TOML、XML、Markdown、HCL、Make）。これらは `hesman grammars install` でインストールできますが、Hesmanはまだ使用しません。これらの言語のファイルはテキストとしてインデックスされ、文法が自動的にダウンロードされることはありません。

各ティアの現時点での意味：

- **deep** — 定義（関数、クラス、メソッド、定数など）に加えて `calls` リレーションを持つため、`get_callers`、`get_callees`、`get_references`、`impact_analysis` でコールグラフを利用できます。呼び出しは各言語の構文木（呼び出し式、`new X(...)`、RubyとBashの括弧なしの呼び出し）から読み取られ、名前でリンクされます。まず呼び出し元自身のファイル、次にそのファイルがインポートするファイル、同じディレクトリ、そしてプロジェクトの順に探し、それでも曖昧な名前は、すべての候補にリンクするのではなく未リンクのままにします。呼び出しは、本体のない宣言（C/C++のプロトタイプ、インターフェースメソッドや抽象メソッド）ではなく定義にリンクされ、`new X(...)` はコンストラクタのいずれかではなくクラス `X` にリンクされます。型は解決されないため、複数の実装を持つインターフェースに対して呼び出されたメソッドは未リンクのままになり、引数も括弧もなしで呼び出されたRubyのメソッドは呼び出しとして認識されません。インポートのリレーションはTypeScript/JavaScript、Python、Go、C/C++（`#include "..."`）、Ruby（`require`、`require_relative`）にあります。`extends` / `implements` のリレーションは、言語が `class X extends Y` または `class X implements Y` と書く場合にのみあります。
- **structural** — 定義のみ。同梱の言語でこのティアに属するものはもうありません。オンデマンドの言語が structural なのは、上流のシンボル用クエリだけを使っているためです。可視性のルールがなく（すべての定義がエクスポート済みとして扱われます）、呼び出しの抽出もありません。
- **text** — シンボルなし。[docs/TOOLS.md](../TOOLS.md) の「Text tier」を参照してください。

エージェントがこの表を知っている必要はありません。コールグラフのない言語のシンボルについて `get_callers`、`get_callees`、`get_references` または `impact_analysis` が呼ばれると、レスポンスには空のリストとともに `call graph not available for r (symbols only)` のような `note` が付くため、空の結果が「どこからも使われていない」と誤解されることはありません。

シンボルの種類は各文法自身のtagsクエリに従うため、言語本来の区別より粗いものがあります。PHPとKotlinのメソッドは `function`、RustとSwiftのenumおよびKotlinのインターフェースは `class`、Rustの型エイリアスは `class` です。言語を追加するには、文法、tagsクエリ、小さなプロファイル、そして言語レジストリ（`src/parsers/languages.ts`）へのエントリ1つが必要です。詳しい手順は[コントリビューティングガイド](../CONTRIBUTING.md)を参照してください。

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

**コアデータパイプライン:** ファイル変更（chokidar）→ Tree-sitterによるパース（AST + シンボル）→ SQLiteインデックス + ZVec埋め込み → コンパクトなMCPレスポンス

**主要な設計判断:**
- **LSP非依存** — Tree-sitterが、言語サーバーを起動せずに言語に依存しないパースを提供
- **コンテンツハッシュによるインクリメンタルインデックス** — SHA-256が変わった場合にのみファイルを再パース
- **レスポンスレベルでの圧縮** — 元のデータはそのまま保持し、圧縮はレスポンスの境界で適用
- **プロジェクトごとに単一のSQLiteデータベース** — モノレポでも、すべてのパッケージが `file_path` による分離で1つのストアを共有

モジュールの依存関係、ストアのスキーマ、ワーカープールの設計を含む完全なアーキテクチャドキュメントについては、**[docs/ARCHITECTURE.md](../ARCHITECTURE.md)** を参照してください。

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

### パフォーマンスの閾値

`npm run test:perf` は、ベンチマークがそのしきい値より悪いと失敗します（`tests/perf/thresholds.ts`）。これらはメンテナーのmacOSマシンで、リポジトリのフィクスチャに対して確認された上限値であり、すべてのプロジェクトに対する保証ではありません。`semantic_search` は、クエリの埋め込みを除いて計測されます。

| ベンチマーク | しきい値 |
|---|---|
| `find_symbol`（完全一致） | < 1ms |
| `find_symbol`（あいまい一致） | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |

### このリポジトリでの計測

`node scripts/measure.mjs` は、ビルド済みのサーバーをstdio経由で起動し、このリポジトリのクリーンなエクスポート（502ファイル：350件はシンボルあり、152件はテキスト。7,700シンボル、27,372リレーション）をインデックスさせ、MCP経由で各ツールを100回呼び出します。計測日は2026-10-13で、Apple M3 Pro（11コア、18 GB）、macOS、Node 24 上で行いました。数値はマシンとプロジェクトによって異なります。ご自身の数値はスクリプトを実行して取得してください。

| 起動、インデックス、メモリ | セマンティック検索あり | `--no-semantic` |
|---|---:|---:|
| MCPハンドシェイクへの応答まで | 0.4 s | 0.2 s |
| インデックス完了まで | 70.2 s | 2.4 s |
| ディスク上のインデックス | 46.2 MB | 22.1 MB |
| ハンドシェイク時のメモリ | 286 MB | 195 MB |
| インデックス直後のメモリ | 673 MB | 426 MB |
| 待機時のメモリ（最後の呼び出しから35秒後） | 545 MB | 303 MB |

サーバーはインデックス作成中もツールに応答します。セマンティック検索をオンにした場合、70秒のほぼすべては、CPUで5,760個の埋め込みを計算することに費やされます。メモリはプロセスの物理的なフットプリントで、アクティビティモニタに表示される数値です。パーサースレッドはインデックス作成中のみ起動され（デフォルトでは最大4つ）、アイドル時間が30秒続くと解放されます。

| ツール | 呼び出し | 中央値 | 素のトークン | 返されるトークン | 削減率 |
|---|---|---:|---:|---:|---:|
| `get_context` | 1関数、±5行 | 0.39 ms | 4,782 | 190 | 96.0% |
| `get_context` | 1関数、±40行 | 0.46 ms | 4,782 | 970 | 79.7% |
| `get_references` | `indexProject` への参照 | 0.29 ms | 3,026 | 854 | 71.8% |
| `get_callers` | `indexProject` の呼び出し元 | 0.24 ms | 1,244 | 373 | 70.0% |
| `get_callees` | `indexProject` の呼び出し先 | 0.15 ms | 387 | 132 | 65.9% |
| `find_symbol` | 接頭辞 `index`、20件の結果 | 0.38 ms | 2,326 | 1,369 | 41.1% |
| `impact_analysis` | `indexProject` の削除 | 0.39 ms | 3,498 | 2,116 | 39.5% |
| `get_file_structure` | 1つのソースファイル | 0.34 ms | 3,474 | 2,270 | 34.7% |
| `list_dependencies` | 1つのファイルのインポート | 0.11 ms | 572 | 374 | 34.6% |
| `find_symbol` | 完全一致の名前、1件の結果 | 0.14 ms | 214 | 197 | 7.9% |
| `find_pattern` | TypeScriptでの `console.$M($$$A)` | 38.4 ms | 2,112 | 2,112 | 0.0% |
| `semantic_search` | 自然言語のクエリ1件 | 2.75 ms | 3,880 | 3,880 | 0.0% |

「素のトークン」は、絶対パスを含む素のJSONオブジェクトとしてのペイロードです（`get_context` の場合はファイル全体）。トークン数は1トークンあたり4文字として見積もっています。遅延は、MCPのフレーミングを含めて、クライアントが1回の呼び出しで観測した時間です。`semantic_search` にはクエリの埋め込みが含まれます。

---

## 要件

| リソース | 最小要件 |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **メモリ** | 待機時は約300 MB、セマンティック検索なしでのインデックス作成時は約430 MB。セマンティック検索ありでは、待機時は約550 MB、インデックス作成時は約670 MB（502ファイルのプロジェクトでの計測。[このリポジトリでの計測](#このリポジトリでの計測)を参照） |
| **ディスク** | パッケージに約30 MB（同梱の文法）、埋め込みモデルに約80 MB（一度きりのダウンロード）、オンデマンドの文法をすべてインストールした場合は最大47 MB、加えて `.hesman/` 内のインデックス |
| **ネットワーク** | インストール時、初回使用時の埋め込みモデル、およびプロジェクトにオンデマンド言語が初めて含まれたときのその文法のために必要。それ以外は不要で、コードやクエリがどこかに送信されることは決してありません |

埋め込みモデル（`all-MiniLM-L6-v2`）は初回使用時にダウンロードされ、Transformers.jsのキャッシュディレクトリに無期限でキャッシュされます。

---

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [README.md](../../README.md) | プロジェクトの概要、セットアップ、設定（このファイル） |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | 完全なアーキテクチャ：データフロー、モジュールマップ、ストアのスキーマ、ワーカープールの設計 |
| [docs/CLI.md](../CLI.md) | すべてのサブコマンド：`setup`、`remove`、`doctor`、`ui`、`grammars` と、そのオプションおよび出力 |
| [docs/TOOLS.md](../TOOLS.md) | 全11ツールの完全な入出力スキーマと例 |
| [docs/CONTRIBUTING.md](../CONTRIBUTING.md) | 開発環境のセットアップ、テストガイド、言語プロファイルの作成、PRチェックリスト |
| [docs/SECURITY.md](../SECURITY.md) | 脅威モデル、ツール入力に対するガード、脆弱性の報告方法 |
| [CHANGELOG.md](../../CHANGELOG.md) | バージョン履歴と変更点 |

---

## ライセンス

[MIT](../../LICENSE) — Copyright (c) 2026 Minh Do

MITライセンスは、Hesmanのために書かれたコードを対象とします。サードパーティのソフトウェアは、それぞれ独自のライセンスのままです：

- **パッケージに含まれるもの：** Tree-sitterの文法とクエリファイル。Elixirのクエリ（Apache-2.0。その文法のライセンス）を除き、すべてMITです。それぞれがリポジトリ、リビジョン、著作権表示とともに [NOTICE](../../NOTICE) に記載されています。
- **npmが依存関係としてインストールするもの：** すべて寛容なライセンス（MIT、ISC、BSD、Apache-2.0）です。完全な一覧は [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md) にあります。埋め込みライブラリ `@xenova/transformers` とベクトルストア `@zvec/zvec` はApache-2.0です。
- **実行時にダウンロードされるもの：** 埋め込みモデル `Xenova/all-MiniLM-L6-v2`（Apache-2.0）とオンデマンドの文法（MIT。ただしElixirとHCLはApache-2.0）。[NOTICE](../../NOTICE) を参照してください。埋め込みライブラリの依存関係である `sharp` は、ビルド済みのlibvips（LGPL-3.0-or-later）を独立した共有ライブラリとしてインストールします。
