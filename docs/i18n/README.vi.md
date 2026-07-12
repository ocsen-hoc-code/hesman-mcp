# Hesman MCP Server

[![CI](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **Đọc bằng:** [English](../../README.md) | **Tiếng Việt** | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** là một máy chủ MCP (Model Context Protocol) thế hệ mới giúp các tác nhân AI viết mã hiểu sâu về mã nguồn của bạn — biểu tượng (symbol), đồ thị lời gọi (call graph), phụ thuộc (dependency), và tìm kiếm ngữ nghĩa (semantic search) — với một pipeline nén 3 lớp giúp giảm đáng kể lượng token tiêu thụ (lên đến 97% trong trường hợp lý tưởng). Mọi thứ đều chạy trên máy cục bộ. Không cần API bên ngoài. Không cần máy chủ LSP.

---

## Mục lục

- [Tại sao chọn Hesman?](#t%E1%BA%A1i-sao-ch%E1%BB%8Dn-hesman)
- [Bắt đầu nhanh](#b%E1%BA%AFt-%C4%91%E1%BA%A7u-nhanh)
- [Tính năng](#t%C3%ADnh-n%C4%83ng)
- [Cách giảm token hoạt động](#c%C3%A1ch-gi%E1%BA%A3m-token-ho%E1%BA%A1t-%C4%91%E1%BB%99ng)
- [Cài đặt & Thiết lập](#c%C3%A0i-%C4%91%E1%BA%B7t--thi%E1%BA%BFt-l%E1%BA%ADp)
- [Tham chiếu công cụ](#tham-chi%E1%BA%BFu-c%C3%B4ng-c%E1%BB%A5)
- [Cấu hình](#c%E1%BA%A5u-h%C3%ACnh)
- [Tham chiếu CLI](#tham-chi%E1%BA%BFu-cli)
- [Ngôn ngữ được hỗ trợ](#ng%C3%B4n-ng%E1%BB%AF-%C4%91%C6%B0%E1%BB%A3c-h%E1%BB%97-tr%E1%BB%A3)
- [Kiến trúc](#ki%E1%BA%BFn-tr%C3%BAc)
- [Thiết lập phát triển](#thi%E1%BA%BFt-l%E1%BA%ADp-ph%C3%A1t-tri%E1%BB%83n)
- [Yêu cầu hệ thống](#y%C3%AAu-c%E1%BA%A7u-h%E1%BB%87-th%E1%BB%91ng)
- [Tài liệu](#t%C3%A0i-li%E1%BB%87u)
- [Giấy phép](#gi%E1%BA%A5y-ph%C3%A9p)

---

## Tại sao chọn Hesman?

Các tác nhân AI viết mã rất mạnh mẽ nhưng cũng rất tốn kém. Mỗi dòng mã chúng đọc đều tiêu tốn token. Gửi toàn bộ một tệp tin trong khi tác nhân chỉ cần một hàm duy nhất là lãng phí ngữ cảnh và tiền bạc.

Hesman giải quyết vấn đề này bằng cách:

- **Chỉ cung cấp những gì tác nhân cần** — một hàm cụ thể, các hàm gọi đến nó, các hàm nó gọi, hoặc các biểu tượng bị ảnh hưởng bởi một thay đổi.
- **Nén mọi phản hồi** — một pipeline 3 lớp loại bỏ chú thích, cắt bỏ mã không liên quan, và tóm tắt các tập kết quả lớn.
- **Thay thế dump thô bằng tóm tắt** — thay vì 200 tham chiếu trong một mảng JSON, tác nhân nhận được một khối `_summary` với số lượng được phân nhóm theo loại và tệp tin.
- **Chạy 100% trên máy cục bộ** — không cần khóa API, không gọi mạng, không độ trễ từ dịch vụ bên ngoài. Mã của bạn không bao giờ rời khỏi máy của bạn.
- **Tiết kiệm có thể đo lường** — mọi phản hồi đều có `_meta.reduction` hiển thị chính xác số token đã tiết kiệm so với đầu ra thô.

Kết quả: các tác nhân làm việc nhanh hơn, tốn ít chi phí hơn, và suy luận chính xác hơn vì chúng thấy đúng mã cần thiết, chứ không phải toàn bộ mã nguồn.

---

## Bắt đầu nhanh

```bash
# 1. Cài đặt global
npm install -g hesman-mcp

# 2. Chạy máy chủ bên trong dự án của bạn
cd my-project
hesman

# 3. Đăng ký với tác nhân AI của bạn (Claude Desktop, Cursor, VS Code)
hesman install --agent claude
```

Vậy là xong. Sau khi quá trình lập chỉ mục ban đầu hoàn tất (vài giây cho hầu hết các dự án), tác nhân AI của bạn có thể truy vấn mã nguồn thông qua 11 công cụ của Hesman.

---

## Tính năng

### Thông minh mã nguồn

| Khả năng | Mô tả |
|---|---|
| **Tra cứu biểu tượng** | Tìm hàm, lớp, phương thức theo tên — khớp chính xác, mờ, hoặc tiền tố (< 1ms) |
| **Duyệt đồ thị lời gọi** | Truy xuất các hàm gọi đến và được gọi lên đến 3 cấp độ sâu |
| **Theo dõi tham chiếu** | Tìm mọi vị trí sử dụng của một biểu tượng trong toàn bộ mã nguồn |
| **Phân tích tác động** | Xem những gì bị hỏng nếu bạn đổi tên, xóa, hoặc thay đổi chữ ký của một biểu tượng |
| **Tìm kiếm ngữ nghĩa** | Mô tả bằng ngôn ngữ tự nhiên những gì bạn đang tìm và nhận kết quả mã phù hợp |
| **Tìm kiếm cấu trúc** | Tìm các mẫu mã như `console.$METHOD($$$ARGS)` với các nhóm được đặt tên |
| **Phân tích phụ thuộc** | Xem một tệp tin nhập khẩu những gì và những gì nhập khẩu từ nó |
| **Cửa sổ ngữ cảnh** | Lấy mã đã được nén gọn xung quanh bất kỳ vị trí nào trong tệp tin |

### Pipeline Nén Token

Pipeline nén 3 lớp của Hesman giảm lượng token sử dụng ở mọi phản hồi. Mức tiết kiệm thực tế được đo lường và báo cáo qua `_meta.reduction` trong mỗi phản hồi.

| Lớp | Kỹ thuật | Tiết kiệm điển hình | Trường hợp tốt nhất |
|---|---|---|---|
| **Chế độ gọn nhẹ** | Loại bỏ chú thích, dòng trống, khoảng trắng cuối dòng; xóa import không dùng | 10–30% | ~35% (mã có nhiều chú thích) |
| **Cắt tỉa ngữ cảnh** | Chỉ giữ các dòng liên quan đến biểu tượng được truy vấn; thay thế mã bị lược bỏ bằng bộ đếm | 50–80% (cộng dồn lên chế độ gọn nhẹ) | ~95% (tệp lớn với vùng tập trung nhỏ) |
| **Tóm tắt thông minh** | Thay thế mảng kết quả lớn bằng khối `_summary` tổng hợp; nén chuỗi lời gọi thành thống kê nhóm | 70–90% (trên các công cụ dạng danh sách) | ~90% (500+ tham chiếu → tóm tắt) |

**Kết hợp trường hợp tốt nhất:** Một tệp 430 dòng được truy vấn qua `get_context` cho một hàm duy nhất → được cắt tỉa xuống còn ~6 dòng liên quan + chế độ gọn nhẹ → **lên đến 97% giảm tải**. Đây là kịch bản lý tưởng; mức sử dụng điển hình trên tất cả các công cụ trung bình đạt 20–70% giảm tải.

### Sẵn sàng cho sản xuất

- **Nhóm worker** — lập chỉ mục song song trên các nhân CPU, tự động điều chỉnh kích thước theo mặc định
- **Theo dõi tệp tin** — lập chỉ mục gia tăng khi tệp thay đổi qua chokidar
- **Tắt máy an toàn** — xử lý hết công việc đang chạy, ghi dữ liệu xuống bộ nhớ, kết thúc worker sạch sẽ
- **Lập chỉ mục theo hàm băm nội dung** — tệp chỉ được phân tích lại khi nội dung thực sự thay đổi
- **Hỗ trợ monorepo** — tự động phát hiện pnpm, lerna, nx, turbo, và npm workspaces
- **Chẩn đoán** — `hesman diag` in ra thông tin bộ nhớ, thống kê bộ lưu trữ, trạng thái nhóm worker, và số liệu bộ nhớ đệm
- **Kiểm thử CI** — chạy trên Ubuntu, macOS, và Windows với Node 20 và 22

---

## Cách giảm token hoạt động

### Lớp 1: Chế độ Gọn nhẹ

Loại bỏ chú thích, dòng trống, và khoảng trắng cuối dòng trong khi vẫn giữ các chú thích magic (`// @ts-ignore`, `// eslint-disable-*`). Cấp độ 2 bổ sung xử lý JSDoc dựa trên AST và loại bỏ import không dùng.

Trước:
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

Sau (Cấp độ 1):
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

Sau (Cấp độ 2 — dựa trên AST, chỉ giữ JSDoc):
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

### Lớp 2: Cắt tỉa Ngữ cảnh

Khi tác nhân truy vấn `get_context` cho một biểu tượng cụ thể, Hesman chỉ trả về mã liên quan:

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

Cắt tỉa giữ lại: định nghĩa của biểu tượng trọng tâm, chú thích doc của nó, các hàm gọi đến và được gọi trực tiếp trong cùng tệp, và các tham chiếu trong tệp — mọi thứ khác được thay thế bằng bộ đếm.

### Lớp 3: Tóm tắt Thông minh

Thay vì dump 200 tham chiếu trong một mảng JSON:

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

Tác nhân sau đó có thể yêu cầu chi tiết cho các tệp hoặc loại cụ thể — được phân trang qua `cursor`.

### Đo lường Mức tiết kiệm

Mọi phản hồi của Hesman đều bao gồm một khối `_meta` với số token tiết kiệm thực tế:

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

Điều này cho phép bạn kiểm toán chính xác mức độ tiết kiệm mà Hesman mang lại trong khối lượng công việc thực tế của bạn.

---

## Cài đặt & Thiết lập

### Điều kiện tiên quyết

- **Node.js** ≥ 20.0.0
- **npm** (hoặc pnpm / yarn)

### Cài đặt từ npm

```bash
npm install -g hesman-mcp
```

### Cài đặt từ Mã nguồn

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Tải trình phân tích Tree-sitter WASM
npm run build              # Biên dịch TypeScript
npm link                   # Đưa `hesman` ra toàn hệ thống
```

### Đăng ký với các Tác nhân AI

```bash
# Claude Desktop (tự động phát hiện đường dẫn cấu hình theo nền tảng)
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code (với Copilot hoặc Cline)
hesman install --agent vscode

# Sử dụng --global để ghi vào cấu hình ở cấp độ người dùng thay vì cấp độ dự án
hesman install --agent claude --global
```

Sau khi cài đặt, khởi động lại tác nhân AI của bạn và Hesman sẽ có sẵn như một máy chủ MCP.

### Cấu hình MCP Thủ công

Thêm nội dung này vào tệp cấu hình MCP của tác nhân:

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

## Tham chiếu Công cụ

Hesman cung cấp **11 công cụ** qua giao tiếp MCP stdio. Mọi phản hồi đều bao gồm một khối `_meta` với số token tiết kiệm và, khi có thể, một khối `_summary` tổng hợp kết quả.

### Điều hướng Mã nguồn

| Công cụ | Chức năng | Tham số chính |
|---|---|---|
| `find_symbol` | Tìm biểu tượng theo tên với khớp chính xác, mờ, hoặc tiền tố | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Lấy cây phân cấp tất cả biểu tượng trong một tệp | `filePath`, `includeNested` |
| `get_references` | Tìm tất cả vị trí sử dụng của một biểu tượng trong toàn bộ mã nguồn | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Lấy mã đã nén gọn xung quanh một vị trí cụ thể | `filePath`, `startLine`, `contextLines`, `mode` |

### Đồ thị Lời gọi

| Công cụ | Chức năng | Tham số chính |
|---|---|---|
| `get_callers` | Tìm tất cả hàm gọi đến một biểu tượng (lên đến 3 cấp độ sâu) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Tìm tất cả hàm được gọi bởi một biểu tượng (lên đến 3 cấp độ sâu) | `symbolId`, `maxDepth`, `topK` |

### Phân tích

| Công cụ | Chức năng | Tham số chính |
|---|---|---|
| `impact_analysis` | Phân loại những gì bị hỏng nếu một biểu tượng thay đổi (đổi tên/xóa/thay đổi chữ ký) | `symbolId`, `changeType` |
| `list_dependencies` | Hiển thị một tệp nhập khẩu những gì, hoặc những gì nhập khẩu từ nó | `filePath`, `direction` |
| `semantic_search` | Tìm kiếm mã bằng mô tả ngôn ngữ tự nhiên | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Tìm kiếm theo mẫu cấu trúc với các nhóm được đặt tên (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Trạng thái

| Công cụ | Chức năng |
|---|---|
| `index_status` | Báo cáo tình trạng lập chỉ mục: số lượng tệp, số lượng biểu tượng, trạng thái bộ lưu trữ, tệp đang chờ |

Để biết lược đồ đầu vào/đầu ra đầy đủ kèm ví dụ, xem **[docs/TOOLS.md](./docs/TOOLS.md)**.

---

## Cấu hình

Tạo một tệp `hesman.config.json` trong thư mục gốc của dự án (tất cả các trường đều tùy chọn):

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

### Thứ tự Ưu tiên Cấu hình

Các thiết lập được giải quyết theo thứ tự sau (thiết lập sau ghi đè thiết lập trước):

1. **Mặc định** — được tích hợp sẵn trong Hesman
2. **`hesman.config.json`** — tệp cấu hình cấp độ dự án
3. **Biến môi trường** — ví dụ: `HESMAN_WORKERS=4`
4. **Cờ CLI** — ví dụ: `--workers 4`

### Biến Môi trường

| Biến | Tương đương | Mô tả |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Đường dẫn đến dự án cần lập chỉ mục |
| `HESMAN_WORKERS` | `--workers N` | Số lượng luồng worker (0 = tự động phát hiện) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Một trong: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Thư mục cho dữ liệu chỉ mục (mặc định: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Bật/tắt theo dõi tệp tin (true/false) |

### Cờ CLI

| Cờ | Mô tả |
|---|---|
| `--project-root <path>` | Thư mục gốc của dự án |
| `--workers <N>` | Số lượng luồng worker (0 = tự động) |
| `--log-level <level>` | Cấp độ ghi log |
| `--data-dir <path>` | Đường dẫn thư mục dữ liệu |
| `--watch-mode` | Bật theo dõi tệp tin |
| `--no-watch` | Tắt theo dõi tệp tin |
| `--no-semantic` | Tắt tìm kiếm ngữ nghĩa |
| `--batch-size <N>` | Số tệp mỗi lô lập chỉ mục |

---

## Tham chiếu CLI

```
hesman                         Chạy máy chủ MCP qua stdio (mặc định)
hesman index [path]            Lập chỉ mục dự án mà không khởi động máy chủ
hesman status [path]           Hiển thị tiến trình lập chỉ mục và thống kê
hesman clean [path]            Xóa thư mục dữ liệu .hesman/
hesman clean --force           Bỏ qua lời nhắc xác nhận
hesman clean --dry-run         Xem trước những gì sẽ bị xóa mà không xóa thực tế
hesman diag [path]             In thông tin chẩn đoán: bộ nhớ, thống kê bộ lưu trữ, nhóm worker, bộ đệm
hesman diag --json             Xuất chẩn đoán dưới dạng JSON
hesman install --agent <name>  Ghi cấu hình MCP cho Claude Desktop, Cursor, hoặc VS Code
hesman install --global        Ghi vào cấu hình cấp độ người dùng thay vì cấp độ dự án
hesman --version, -v           In số phiên bản
hesman --help, -h              Hiển thị văn bản trợ giúp
```

---

## Ngôn ngữ được hỗ trợ

| Ngôn ngữ | Phần mở rộng | Trạng thái |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | Hỗ trợ đầy đủ |
| Python | `.py`, `.pyw`, `.pyi` | Hỗ trợ đầy đủ |
| Go | `.go` | Hỗ trợ đầy đủ |

Kiến trúc hỗ trợ lên đến **158 ngôn ngữ** qua Tree-sitter. Thêm một ngôn ngữ mới yêu cầu triển khai một `LanguageProfile` — xem [Hướng dẫn Đóng góp](./docs/CONTRIBUTING.md) để biết hướng dẫn từng bước.

---

## Kiến trúc

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
                         │   │  Pipeline Nén 3 Lớp              │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Chế độ Gọn nhẹ          │  │  │
                         │   │  │    Xóa chú thích/dòng trống │  │  │
                         │   │  │ 2. Cắt tỉa Ngữ cảnh        │  │  │
                         │   │  │    Giữ chỉ dòng liên quan   │  │  │
                         │   │  │ 3. Tóm tắt Thông minh      │  │  │
                         │   │  │    Tổng hợp & nén            │  │  │
                         │   │  └────────────────────────────┘  │  │
                         │   └───────────────────────────────────┘  │
                         │                                          │
                         │   ┌──────────┐ ┌──────────┐ ┌─────────┐ │
                         │   │  SQLite  │ │   ZVec   │ │ Worker  │ │
                         │   │  Store   │ │  Vector  │ │  Pool   │ │
                         │   │ (biểu tượng)│ │ (tìm kiếm)│ │ (chỉ mục)│ │
                         │   └────┬─────┘ └────┬─────┘ └────┬────┘ │
                         │        │            │            │       │
                         │   ┌────┴────────────┴────────────┴────┐  │
                         │   │  Trình theo dõi Tệp (chokidar)   │  │
                         │   └───────────────────────────────────┘  │
                         └──────────────────────────────────────────┘
```

**Pipeline dữ liệu cốt lõi:** Thay đổi tệp (chokidar) → Phân tích Tree-sitter (AST + biểu tượng) → Chỉ mục SQLite + Nhúng ZVec → Phản hồi MCP đã nén

**Các quyết định thiết kế chính:**
- **Không phụ thuộc vào LSP** — Tree-sitter cung cấp khả năng phân tích độc lập ngôn ngữ mà không cần chạy máy chủ ngôn ngữ
- **Lập chỉ mục gia tăng theo hàm băm nội dung** — tệp chỉ được phân tích lại khi SHA-256 thay đổi
- **Nén ở cấp độ phản hồi** — dữ liệu gốc được giữ nguyên vẹn; nén được áp dụng tại ranh giới phản hồi
- **Một cơ sở dữ liệu SQLite duy nhất cho mỗi dự án** — ngay cả trong monorepo, tất cả các gói đều dùng chung một bộ lưu trữ với phân cách `file_path`

Để xem tài liệu kiến trúc đầy đủ bao gồm phụ thuộc mô-đun, lược đồ bộ lưu trữ, và thiết kế nhóm worker, xem **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

---

## Thiết lập Phát triển

### Điều kiện tiên quyết

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Bắt đầu

```bash
# Sao chép và cài đặt
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Tải trình phân tích Tree-sitter WASM
npm run download:parsers

# Chạy ở chế độ phát triển (tự động tải lại)
npm run dev

# Xây dựng cho sản xuất
npm run build
```

### Chất lượng Mã

```bash
npm run typecheck    # Kiểm tra kiểu TypeScript
npm run lint         # ESLint
npm run format       # Định dạng Prettier
```

### Chạy Kiểm thử

```bash
npm test                  # Chạy tất cả kiểm thử (đơn vị + tích hợp)
npm run test:watch        # Chế độ theo dõi cho phát triển
npm run test:e2e          # Kiểm thử đầu cuối (khởi động máy chủ đầy đủ)
npm run test:perf         # Đo điểm chuẩn hiệu năng
```

### Mục tiêu Hiệu năng

| Đo điểm chuẩn | Mục tiêu |
|---|---|
| Thông lượng lập chỉ mục | ≥ 500 tệp/giây |
| `find_symbol` (chính xác) | < 1ms |
| `find_symbol` (mờ) | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |
| Bộ nhớ (sau lập chỉ mục) | < 350MB |

Để xem hướng dẫn đóng góp đầy đủ bao gồm cách thêm ngôn ngữ mới, xem **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**.

---

## Yêu cầu Hệ thống

| Tài nguyên | Tối thiểu |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Bộ nhớ (không tải)** | ~100 MB |
| **Bộ nhớ (có tải)** | ~350 MB |
| **Đĩa cứng** | ~80 MB (tải mô hình nhúng một lần) |
| **Mạng** | Chỉ cho `npm install` ban đầu; không gọi mạng khi chạy |

Mô hình nhúng (`all-MiniLM-L6-v2`) được tải xuống trong lần sử dụng đầu tiên và được lưu vào bộ nhớ đệm vĩnh viễn trong thư mục bộ đệm của Transformers.js.

---

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [README.md](../../README.md) | Tổng quan dự án, thiết lập, và cấu hình (tệp này) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Kiến trúc đầy đủ: luồng dữ liệu, sơ đồ mô-đun, lược đồ bộ lưu trữ, thiết kế nhóm worker |
| [docs/TOOLS.md](./docs/TOOLS.md) | Lược đồ đầu vào/đầu ra hoàn chỉnh cho tất cả 11 công cụ kèm ví dụ |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Thiết lập phát triển, hướng dẫn kiểm thử, viết hồ sơ ngôn ngữ, danh sách kiểm tra PR |
| [CHANGELOG.md](./CHANGELOG.md) | Lịch sử phiên bản và thay đổi |

---

## Giấy phép

[MIT](./LICENSE) — Bản quyền (c) 2026 Minh Do
