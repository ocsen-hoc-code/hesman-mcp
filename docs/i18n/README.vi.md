# Hesman MCP Server

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

🌐 **Đọc bằng:** [English](../../README.md) | **Tiếng Việt** | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** là một MCP server (Model Context Protocol) thế hệ mới, giúp các AI agent lập trình hiểu sâu codebase của bạn — symbol, call graph, phụ thuộc và tìm kiếm ngữ nghĩa — với cách đọc mã có trọng tâm giúp giảm lượng token tiêu thụ (`get_context` trả về ít hơn ~90% token so với cả tệp khi bạn hỏi về vùng xung quanh một hàm). Mọi thứ chạy cục bộ. Không API bên ngoài. Không LSP server.

---

## Mục lục

- [Tại sao chọn Hesman?](#tại-sao-chọn-hesman)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [Tính năng](#tính-năng)
- [Cơ chế giảm token](#cơ-chế-giảm-token)
- [Cài đặt & Thiết lập](#cài-đặt--thiết-lập)
- [Tham chiếu công cụ](#tham-chiếu-công-cụ)
- [Cấu hình](#cấu-hình)
- [Tham chiếu CLI](#tham-chiếu-cli)
- [Ngôn ngữ được hỗ trợ](#ngôn-ngữ-được-hỗ-trợ)
- [Kiến trúc](#kiến-trúc)
- [Thiết lập môi trường phát triển](#thiết-lập-môi-trường-phát-triển)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Tài liệu](#tài-liệu)
- [Giấy phép](#giấy-phép)

---

## Tại sao chọn Hesman?

Các AI agent lập trình rất mạnh nhưng cũng tốn kém. Mỗi dòng mã chúng đọc đều tiêu tốn token. Gửi cả một tệp trong khi agent chỉ cần một hàm là lãng phí ngữ cảnh và tiền bạc.

Hesman giải quyết việc này bằng cách:

- **Chỉ cung cấp đúng thứ agent cần** — một hàm cụ thể, các hàm gọi nó, các hàm nó gọi, hoặc những symbol bị ảnh hưởng bởi một thay đổi.
- **Thu gọn và cắt tỉa mã** — `get_context` bỏ chú thích và dòng trống, và chỉ trả về các dòng quanh vị trí trọng tâm thay vì cả tệp.
- **Không bao giờ làm phản hồi phình to** — một phản hồi không bao giờ lớn hơn payload gốc của nó. Việc tóm tắt các danh sách kết quả dài đã được lên kế hoạch nhưng chưa được áp dụng (xem [Pipeline giảm token](#pipeline-giảm-token)).
- **Chạy trên máy của bạn** — không khóa API, không dịch vụ bên ngoài, không độ trễ từ dịch vụ như vậy. Mã của bạn không bao giờ rời khỏi máy. Những lần tải về duy nhất là mô hình embedding ở lần dùng đầu tiên và grammar của các ngôn ngữ tải khi cần; cả hai đều có thể tắt (`--no-semantic`, `HESMAN_GRAMMARS_OFFLINE=1`).
- **Mức tiết kiệm đo được** — mọi phản hồi của công cụ, trừ `index_status`, đều có `_meta.reduction` cho biết chính xác đã tiết kiệm bao nhiêu token so với đầu ra thô.

Kết quả: agent làm việc nhanh hơn, tốn ít chi phí hơn và suy luận chính xác hơn, vì chúng thấy đúng phần mã cần thiết chứ không phải toàn bộ mã.

---

## Bắt đầu nhanh

`hesman-mcp` chưa có trên npm registry, nên hiện tại Hesman được cài từ mã nguồn:

```bash
# 1. Lấy mã và build Hesman (Node.js ≥ 20)
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers
npm run build

# 2. Đăng ký với các AI client của bạn (phát hiện Claude Code, Cursor, VS Code, Codex, …)
node dist/index.js setup
```

Khởi động lại client và mở một dự án. `setup` ghi lệnh khởi chạy phù hợp với cách Hesman được cài (ở đây: đường dẫn tuyệt đối tới `node` và `dist/index.js`, nên không cần thứ gì nằm trên PATH); xem [Lệnh khởi chạy](#lệnh-khởi-chạy).

Sau khi gói được phát hành, toàn bộ phần bắt đầu nhanh chỉ còn một dòng:

```bash
npx -y hesman-mcp setup   # chỉ dùng được khi hesman-mcp đã được phát hành trên npm
```

Server trả lời agent ngay lập tức và lập chỉ mục ở chế độ nền (vài giây với hầu hết dự án): 11 công cụ hoạt động ngay, đánh dấu kết quả bằng `_meta.indexing` khi chỉ mục còn chưa đầy đủ, và `index_status` báo cáo tiến độ.

---

## Tính năng

### Hiểu mã nguồn

| Khả năng | Mô tả |
|---|---|
| **Tra cứu symbol** | Tìm hàm, lớp, phương thức theo tên — khớp chính xác, khớp mờ hoặc theo tiền tố (< 1ms) |
| **Duyệt call graph** | Đi theo các hàm gọi (caller) và hàm được gọi (callee), sâu tối đa 3 cấp |
| **Theo dõi tham chiếu** | Tìm mọi nơi sử dụng một symbol trong toàn bộ codebase |
| **Phân tích tác động** | Xem cái gì sẽ hỏng nếu bạn đổi tên, xóa, hoặc đổi chữ ký của một symbol |
| **Tìm kiếm ngữ nghĩa** | Mô tả thứ bạn cần tìm bằng ngôn ngữ tự nhiên và tìm ra đoạn mã phù hợp |
| **Tìm kiếm theo cấu trúc** | Tìm các mẫu mã như `console.$METHOD($$$ARGS)` với các capture có tên |
| **Phân tích phụ thuộc** | Xem một tệp import những gì và những tệp nào import từ nó |
| **Cửa sổ ngữ cảnh** | Lấy phần mã có trọng tâm, đã thu gọn, quanh một vị trí bất kỳ trong tệp |

### Pipeline giảm token

Hesman thiết kế pipeline nén của mình thành 3 lớp; hiện tại mức tiết kiệm đến từ chế độ compact và cắt tỉa ngữ cảnh trong `get_context`. Mọi phản hồi đều báo cáo mức tiết kiệm thực tế của nó trong `_meta.reduction`, và một phản hồi không bao giờ lớn hơn payload gốc của nó.

| Lớp | Kỹ thuật | Mức tiết kiệm đo được | Trạng thái |
|---|---|---|---|
| **Chế độ compact** | Bỏ chú thích, dòng trống, khoảng trắng cuối dòng | ~14–16% của một đoạn trích mã (`get_context`, `mode: "full"` so với `"compact"`) | Đã áp dụng trong `get_context` |
| **Cắt tỉa ngữ cảnh** | Trích một khoảng dòng quanh vị trí trọng tâm + chế độ compact | 89.9% với mặc định ±5 dòng, 29.9% với ±40 dòng (tệp 195 dòng); 0% khi yêu cầu cả tệp | Đã áp dụng trong `get_context` |
| **Tóm tắt thông minh** | Các khối `_summary` tổng hợp cho những danh sách kết quả dài | 0% — `_summary` chỉ làm phản hồi dài thêm, nên nó bị bỏ đi | Chưa áp dụng ([backlog](../../tasks/STATUS.md)) |

Các công cụ dạng danh sách và call graph (`get_references`, `get_callers`, `get_callees`, `list_dependencies`, `get_file_structure`) hiện trả về payload gốc với `_meta.reduction: "0.0%"` và `_meta.compressed: false`. Số liệu được đo trên thư mục `src/` của chính repository này và trên `tests/fixtures/polyglot-basic`. Trường `_meta.reduction` trong mỗi phản hồi cho biết mức tiết kiệm chính xác với khối lượng công việc của bạn.

### Sẵn sàng cho production

- **Worker pool** — lập chỉ mục song song trên các nhân CPU, mặc định tự chọn kích thước
- **Theo dõi tệp** — lập chỉ mục lại theo kiểu gia tăng khi tệp thay đổi, thông qua chokidar
- **Tắt máy êm (graceful shutdown)** — xử lý xong công việc đang chạy, flush các store, kết thúc worker gọn gàng
- **Lập chỉ mục theo hash nội dung** — tệp chỉ được phân tích lại khi nội dung thực sự thay đổi
- **Hỗ trợ monorepo** — tự phát hiện workspace của pnpm, lerna, nx, turbo và npm
- **Chẩn đoán** — `hesman diag` in ra bộ nhớ, thống kê store, trạng thái pool và số liệu cache
- **Được kiểm thử cục bộ** — toàn bộ bộ test, gồm cả các test end-to-end qua server thật, chạy trên macOS; Linux và Windows chưa được xác minh

---

## Cơ chế giảm token

### Lớp 1: Chế độ compact

Bỏ chú thích, dòng trống và khoảng trắng cuối dòng, đồng thời giữ lại các magic comment (`// @ts-ignore`, `// eslint-disable-*`).

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

Sau:
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

### Lớp 2: Cắt tỉa ngữ cảnh

`get_context` không trả về cả tệp. Nó trả về khoảng dòng được yêu cầu cộng thêm `contextLines` dòng phía trên và phía dưới (mặc định 5, tối đa 200), rồi áp dụng chế độ compact lên đoạn trích đó. `_meta.reduction` so sánh kết quả với cả tệp, và `_meta.layers` liệt kê những gì đã được áp dụng (`compact`, `prune`).

Việc cắt tỉa chỉ dựa trên khoảng dòng: nó không lần theo caller hay callee. Để đọc những gì một hàm gọi hoặc những gì gọi nó, hãy hỏi `get_callees` / `get_callers` để lấy các vị trí, rồi gọi `get_context` cho từng vị trí.

### Lớp 3: Tóm tắt thông minh (chưa áp dụng)

Kế hoạch là thay các danh sách kết quả dài bằng một `_summary` tổng hợp (số lượng theo loại và theo tệp) cùng các mục đứng đầu. Bản cài đặt hiện tại chỉ *thêm* một `_summary` bên cạnh danh sách đầy đủ, khiến phản hồi lớn hơn, nên Hesman bỏ nó đi và trả về payload gốc: các công cụ dạng danh sách và call graph hiện báo `_meta.reduction: "0.0%"`. Việc làm cho phần tóm tắt thực sự tiết kiệm token đang được theo dõi trong backlog ([`tasks/STATUS.md`](../../tasks/STATUS.md)). Các danh sách dài hiện đã có thể lấy theo từng trang qua `topK` và `cursor` (`get_references`).

### Đo mức tiết kiệm

Mọi phản hồi của Hesman đều có một khối `_meta` với mức tiết kiệm token thực tế:

```json
{
  "_meta": {
    "originalTokens": 1764,
    "compressedTokens": 178,
    "reduction": "89.9%",
    "compressed": false,
    "layers": ["prune"]
  }
}
```

Ví dụ này là một lệnh gọi `get_context` thật (mặc định ±5 dòng, chế độ compact) trên một tệp 195 dòng: đoạn trích đã được chính công cụ thu gọn, nên chỉ lớp `prune` được liệt kê, và `compressed: false` nghĩa là bộ nén phản hồi không còn gì để loại bỏ thêm. Trường `_meta.reduction` so với số token ban đầu của cả tệp, cho bạn mức tiết kiệm thực sự từ đầu đến cuối. Những phản hồi không thể nhỏ hơn được trả về nguyên trạng với `reduction: "0.0%"`; giá trị này không bao giờ âm. Hãy kiểm tra chính xác Hesman tiết kiệm bao nhiêu trong công việc thực tế của bạn bằng cách xem `_meta.reduction` trên bất kỳ phản hồi nào của công cụ.

---

## Cài đặt & Thiết lập

### Điều kiện tiên quyết

- **Node.js** ≥ 20.0.0
- **npm** (hoặc pnpm / yarn)

### Cài đặt từ mã nguồn

Đây là cách hoạt động được ở thời điểm hiện tại.

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # Tải các parser WASM của Tree-sitter
npm run build              # Biên dịch TypeScript
npm link                   # Tùy chọn: đưa `hesman` vào PATH
```

Nếu không dùng `npm link`, hãy dùng `node /path/to/hesman-mcp/dist/index.js` ở mọi chỗ README này viết `hesman`.

### Cài đặt từ npm (sau khi gói được phát hành)

`hesman-mcp` chưa có trên npm registry. Khi đã có:

```bash
npx -y hesman-mcp setup     # không cần cài: các client khởi động Hesman qua npx
npm install -g hesman-mcp   # hoặc cài global để có `hesman` trên PATH
```

### Đăng ký với các AI agent

```bash
hesman setup                         # danh sách chọn các client tìm thấy trên máy này
hesman setup --yes                   # không hỏi gì: cấu hình mọi client được phát hiện
hesman setup --client cursor vscode  # cấu hình các client cụ thể
hesman setup --dry-run --all         # in chính xác thay đổi cho từng client, không ghi gì
hesman remove                        # hoàn tác: gỡ Hesman khỏi mọi client
```

| Client | `--client` | `hesman setup` thay đổi gì (phạm vi user) | `--scope project` |
|---|---|---|---|
| Claude Code | `claude-code` | chạy `claude mcp add --scope user hesman -- <launch command>`; nếu không có CLI thì sửa `~/.claude.json` | `.mcp.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` | — |
| OpenAI Codex CLI | `codex` | chạy `codex mcp add hesman -- <launch command>`; nếu không có CLI thì sửa `~/.codex/config.toml` | `.codex/config.toml` |
| Cursor | `cursor` | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Google Antigravity | `antigravity` | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |
| VS Code (Copilot) | `vscode` | `mcp.json` trong thư mục user của VS Code | `.vscode/mcp.json` |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Windsurf | `windsurf` | `~/.config/devin/mcp_config.json` | — |

- Chỉ riêng mục `hesman` bị đụng tới. Tệp bị thay đổi sẽ được sao chép trước sang `<file>.hesman.bak`, và `hesman remove` khôi phục nó đúng từng byte nếu trong khoảng thời gian đó không có gì khác thay đổi.
- Mục cấu hình không chứa đường dẫn dự án: Hesman tự tìm dự án (xem bên dưới). Có hai ngoại lệ: **Claude Desktop** không có workspace, nên mục của nó ghim một dự án (thư mục hiện tại, hoặc `--project-root <path>`), còn **Cursor** chỉ nhận `--project-root ${workspaceFolder}` ở phạm vi project (trong tệp global `~/.cursor/mcp.json` biến đó có thể là thư mục home của bạn, nên mục global không nêu dự án nào).
- Với **Antigravity** và **Windsurf**, cách dự án được truyền cho server không được ghi trong tài liệu; `hesman setup` in một ghi chú đề nghị bạn kiểm tra sau lần khởi động đầu tiên.
- Các tệp cấu hình có chú thích (JSONC) không được chỉnh sửa: `hesman setup` báo cáo chúng và để nguyên.
- `hesman install --agent <name>` vẫn hoạt động như một alias đã lỗi thời của `hesman setup --client <name> --yes`.

Sau khi thiết lập, hãy khởi động lại client và Hesman sẽ có mặt như một MCP server.

### Quy tắc sử dụng cho agent (opt-in)

Một MCP server đã cài chưa chắc là một MCP server được dùng: agent thường vẫn tìm đến grep và đọc cả tệp. `hesman setup --rules` còn ghi thêm một khối ngắn (14 dòng) vào tệp chỉ dẫn mà mỗi client được chọn đọc trong **dự án hiện tại**, cho biết công cụ Hesman nào trả lời câu hỏi nào. Việc nó có thay đổi tần suất agent gọi các công cụ hay không thì chưa được đo.

```bash
hesman setup --client claude-code codex --rules   # chạy bên trong dự án
hesman setup --all --rules --dry-run              # in khối và các tệp, không ghi gì
hesman remove                                     # cũng xóa luôn khối đó
```

| Client | Tệp chỉ dẫn (tương đối so với dự án) |
|---|---|
| Claude Code | `CLAUDE.md` |
| OpenAI Codex CLI, Windsurf | `AGENTS.md` |
| Gemini CLI, Google Antigravity | `GEMINI.md` |
| Cursor | `.cursor/rules/hesman.mdc` (tệp rule riêng, `alwaysApply: true`) |
| VS Code (Copilot) | `.github/copilot-instructions.md` |
| Claude Desktop | không có: nó không đọc tệp nào của dự án, nên bị bỏ qua kèm một ghi chú |

- **Opt-in.** Không có gì được ghi nếu thiếu `--rules`. Trên terminal không có `--yes`, setup hỏi một lần và câu trả lời mặc định là Không.
- Khối nằm giữa `<!-- hesman:rules:start -->` và `<!-- hesman:rules:end -->`. Chạy setup lần nữa sẽ thay thế nó tại chỗ; phần văn bản ngoài hai dấu mốc không bao giờ bị thay đổi, và một tệp được hai client dùng chung chỉ nhận khối một lần.
- `hesman remove` xóa đúng khối đó và trả lại tệp đúng từng byte; một tệp do Hesman tạo ra và không chứa gì khác sẽ bị xóa. Hãy chạy lệnh trong cùng dự án (hoặc truyền `--project-root <path>`, tùy chọn mà `setup --rules` cũng chấp nhận).
- Các tệp này thường được commit vào git và chia sẻ với cả nhóm. Setup liệt kê những tệp nó đã thay đổi để bạn xem lại (`git diff`) và quyết định có commit hay không.

### Lệnh khởi chạy

`hesman setup --command auto|npx|global|absolute` quyết định các client sẽ chạy gì. Setup không bao giờ dùng mạng.

| `--command` | Mục được ghi | Cần có |
|---|---|---|
| `npx` | `npx -y hesman-mcp@<major>` | gói trên npm (chưa được phát hành) và `npx` trên PATH của client; vẫn dùng được sau khi nâng cấp Node |
| `global` | `hesman` | một bản cài global (hoặc `npm link`) trên PATH của client |
| `absolute` | `/path/to/node /path/to/hesman-mcp/dist/index.js` | không cần gì trên PATH; chạy lại `hesman setup` sau khi đổi phiên bản Node hoặc di chuyển Hesman |

`auto` (mặc định) dựa vào cách bản Hesman đang chạy được khởi động:

1. được khởi động qua `npx` (nó chạy từ một thư mục cache `_npx`) → `npx`;
2. `hesman` trên PATH chính là bản cài này (đã phân giải symbolic link) → `global`;
3. mọi trường hợp khác (checkout mã nguồn, `node_modules` cục bộ, không nằm trên PATH) → `absolute`.

Các ứng dụng desktop (Claude Desktop, Cursor, Antigravity, VS Code, Windsurf) được mở từ Dock hoặc launcher không nhận PATH của shell. Trên macOS và Linux, khi `auto` chọn `npx` hoặc `hesman` mà lệnh đó hoặc `node` không nằm trong một thư mục hệ thống chuẩn (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin`, cộng thêm `/opt/homebrew/bin` trên macOS và `/snap/bin` trên Linux) — trường hợp thường gặp với nvm, fnm, volta hoặc asdf — thì các client đó nhận mục `absolute` thay thế, kèm ghi chú hãy chạy lại `hesman setup` sau khi đổi phiên bản Node. Các client chạy trong terminal (Claude Code, Codex CLI, Gemini CLI) kế thừa shell và giữ lệnh đã chọn. Một `--command npx|global` được chỉ định tường minh sẽ được ghi đúng như yêu cầu cho mọi client, kèm cảnh báo ở những nơi ứng dụng desktop có thể không tìm thấy lệnh.

### Cấu hình MCP thủ công

Thêm đoạn sau vào tệp cấu hình MCP của agent (VS Code dùng `"servers"` thay cho `"mcpServers"` và cần `"type": "stdio"` trong mục; Codex dùng một bảng TOML `[mcp_servers.hesman]`):

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

`--project-root` là tùy chọn; xem bên dưới. `"command": "hesman"` cần `hesman` nằm trên PATH mà client nhìn thấy; nếu không, hãy dùng `"command": "/path/to/node"` với `"/path/to/hesman-mcp/dist/index.js"` làm đối số đầu tiên (xem [Lệnh khởi chạy](#lệnh-khởi-chạy)).

### Cách Hesman chọn dự án

Một tiến trình server lập chỉ mục một dự án. Dự án được chọn theo thứ tự sau:

1. **Root tường minh** — `--project-root <path>`, `HESMAN_PROJECT_ROOT`, hoặc `projectRoot` trong `hesman.config.json`. Luôn thắng.
2. **Các thư mục workspace của MCP client** — khi client hỗ trợ khả năng `roots` của MCP, Hesman hỏi nó danh sách thư mục sau bước handshake và lập chỉ mục thư mục đầu tiên (các thư mục khác được ghi vào log, không được lập chỉ mục). Khi sau đó client báo một thư mục khác, Hesman chuyển sang thư mục ấy.
3. **Thư mục làm việc** — thư mục gần nhất, tính từ thư mục làm việc của server trở lên, có chứa một thư mục quản lý phiên bản (`.git`, `.hg`, `.svn`, `.jj`) hoặc một manifest dự án (`package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, …).
4. **Không có dự án** — server vẫn khởi động và liệt kê các công cụ, nhưng mọi công cụ đều trả về lỗi `NO_PROJECT` giải thích cách đặt root.

Thư mục home và các thư mục cha của nó không bao giờ được chọn tự động (bước 2 và 3), nên một mục MCP global được khởi động từ `~` sẽ không quét khắp ổ đĩa của bạn. Chỉ mục được lưu trong `.hesman/` bên trong dự án được chọn.

---

## Tham chiếu công cụ

Hesman cung cấp **11 công cụ** qua giao thức truyền tải MCP stdio. Mọi phản hồi của công cụ, trừ `index_status`, đều có một khối `_meta` với mức tiết kiệm token của nó (`impact_analysis` còn trả về `_summary` riêng về các tệp bị ảnh hưởng).

### Điều hướng mã nguồn

| Công cụ | Chức năng | Tham số chính |
|---|---|---|
| `find_symbol` | Tìm symbol theo tên với kiểu khớp chính xác, khớp mờ hoặc theo tiền tố | `name`, `kind`, `matchMode`, `topK` |
| `get_file_structure` | Lấy cây phân cấp của mọi symbol trong một tệp | `filePath`, `includeNested` |
| `get_references` | Tìm mọi nơi sử dụng một symbol trong toàn bộ codebase | `symbolId`, `referenceKind`, `topK`, `cursor` |
| `get_context` | Lấy phần mã đã thu gọn quanh một vị trí cụ thể | `filePath`, `startLine`, `contextLines`, `mode` |

### Call graph

| Công cụ | Chức năng | Tham số chính |
|---|---|---|
| `get_callers` | Tìm mọi hàm gọi một symbol cho trước (sâu tối đa 3 cấp) | `symbolId`, `maxDepth`, `topK` |
| `get_callees` | Tìm mọi hàm được một symbol cho trước gọi (sâu tối đa 3 cấp) | `symbolId`, `maxDepth`, `topK` |

### Phân tích

| Công cụ | Chức năng | Tham số chính |
|---|---|---|
| `impact_analysis` | Phân loại những gì sẽ hỏng nếu một symbol thay đổi (đổi tên/xóa/đổi chữ ký) | `symbolId`, `changeType` |
| `list_dependencies` | Cho biết một tệp import những gì, hoặc những tệp nào import từ nó | `filePath`, `direction` |
| `semantic_search` | Tìm mã theo mô tả bằng ngôn ngữ tự nhiên | `query`, `topK`, `language`, `kind` |
| `find_pattern` | Tìm theo mẫu cấu trúc với các capture có tên (`$NAME`, `$$$ARGS`) | `pattern`, `language`, `topK` |

### Trạng thái

| Công cụ | Chức năng |
|---|---|
| `index_status` | Báo cáo tình trạng lập chỉ mục: số tệp, số symbol, trạng thái store, các tệp đang chờ, tiến độ của lần lập chỉ mục nền ban đầu |

Để xem schema đầu vào/đầu ra đầy đủ kèm ví dụ, xem **[docs/TOOLS.md](../TOOLS.md)**.

---

## Cấu hình

Tạo một tệp `hesman.config.json` ở thư mục gốc của dự án (mọi trường đều là tùy chọn):

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

> **Symlink bị bỏ qua khi lập chỉ mục.** Trình quét dự án và trình theo dõi tệp không bao giờ đi theo symbolic link (tới tệp hay thư mục). Điều này ngăn vòng lặp vô hạn (ví dụ `loop -> .`), giữ mã nằm ngoài dự án không lọt vào chỉ mục, và tránh symbol bị trùng. Để lập chỉ mục phần mã được link tới, hãy trỏ `projectRoot` vào thư mục thật.

### Thứ tự ưu tiên cấu hình

Các thiết lập được xác định theo thứ tự sau (mục sau ghi đè mục trước):

1. **Mặc định** — có sẵn trong Hesman
2. **`hesman.config.json`** — tệp cấu hình ở cấp dự án
3. **Biến môi trường** — ví dụ `HESMAN_WORKERS=4`
4. **Cờ CLI** — ví dụ `--workers 4`

### Biến môi trường

| Biến | Tương đương | Mô tả |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | Đường dẫn tới dự án cần lập chỉ mục |
| `HESMAN_WORKERS` | `--workers N` | Số worker thread (0 = tự phát hiện) |
| `HESMAN_LOG_LEVEL` | `--log-level` | Một trong: trace, debug, info, warn, error |
| `HESMAN_DATA_DIR` | `--data-dir` | Thư mục chứa dữ liệu chỉ mục (mặc định: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | Bật/tắt theo dõi tệp (true/false) |
| `HESMAN_GRAMMARS_OFFLINE` | — | `1` hoặc `true`: không bao giờ tải grammar (khóa cấu hình `grammars.offline`) |
| `HESMAN_CACHE_DIR` | — | Thư mục chứa cache grammar theo từng người dùng (`<dir>/hesman/grammars/`) |

### Cờ CLI

| Cờ | Mô tả |
|---|---|
| `--project-root <path>` | Dự án cần lập chỉ mục (mặc định: tự phát hiện, xem [Cách Hesman chọn dự án](#cách-hesman-chọn-dự-án)) |
| `--workers <N>` | Số worker thread (0 = tự động) |
| `--log-level <level>` | Mức ghi log |
| `--data-dir <path>` | Đường dẫn thư mục dữ liệu |
| `--watch-mode` | Bật theo dõi tệp |
| `--no-watch` | Tắt theo dõi tệp |
| `--no-semantic` | Tắt tìm kiếm ngữ nghĩa |
| `--batch-size <N>` | Số tệp trong mỗi lô lập chỉ mục |

---

## Tham chiếu CLI

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

## Ngôn ngữ được hỗ trợ

| Ngôn ngữ | Phần mở rộng | Tầng | Grammar | Hoạt động được gì |
|---|---|---|---|---|
| TypeScript | `.ts`, `.mts`, `.cts` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| TSX | `.tsx` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| JavaScript (và JSX) | `.js`, `.jsx`, `.mjs`, `.cjs` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Python | `.py`, `.pyw`, `.pyi` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Go | `.go` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Java | `.java` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| C | `.c`, `.h` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`, `.ipp`, `.tpp` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| C# | `.cs`, `.csx` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Rust | `.rs` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| PHP | `.php`, `.phtml` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Ruby | `.rb`, `.rake`, `.gemspec`, `.ru`, `.podspec` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Kotlin | `.kt`, `.kts` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Swift | `.swift` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Bash | `.sh`, `.bash` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Lua | `.lua` | deep | đi kèm | Symbol, call graph, phân tích tác động |
| Scala | `.scala`, `.sc`, `.sbt` | structural | tải khi cần | Chỉ symbol (không có call graph) |
| OCaml | `.ml` | structural | tải khi cần | Chỉ symbol (không có call graph) |
| F# | `.fs`, `.fsx` | structural | tải khi cần | Chỉ symbol (không có call graph) |
| R | `.r` | structural | tải khi cần | Chỉ symbol (không có call graph) |
| CodeQL | `.ql`, `.qll` | structural | tải khi cần | Chỉ symbol (không có call graph) |
| Arduino | `.ino` | structural | tải khi cần | Chỉ symbol (không có call graph) |
| Mọi thứ còn lại | mọi tệp văn bản | text | không có | Các đoạn văn bản cho `semantic_search`, `find_pattern` và `get_context` (không có symbol) |

Bảng trên được sinh ra từ registry ngôn ngữ (`npx tsx scripts/generate-language-matrix.ts`; một bài test sẽ thất bại khi bảng lỗi thời). Các grammar ghi *đi kèm* nằm sẵn trong gói, nên chúng hoạt động khi offline.

**Grammar tải khi cần.** Các grammar ghi *tải khi cần* không nằm trong gói. Lần đầu tiên một dự án có tệp thuộc ngôn ngữ như vậy, các tệp đó được lập chỉ mục ngay dưới dạng văn bản và server tải grammar ở chế độ nền (0.3–11.4 MB mỗi grammar, từ trang release của chính repository grammar đó trên GitHub); khi grammar đã về, các tệp được lập chỉ mục lại kèm symbol. Mỗi grammar được ghim bằng URL, kích thước và sha256 trong tệp `grammars.json` đi kèm gói; một bản tải về không khớp sẽ bị loại bỏ và các tệp vẫn ở dạng văn bản. Grammar được cache theo từng người dùng, bên ngoài dự án: `HESMAN_CACHE_DIR`, nếu không thì `XDG_CACHE_HOME`, nếu không thì `~/Library/Caches` (macOS), `%LOCALAPPDATA%` (Windows) hoặc `~/.cache`, trong `hesman/grammars/`.

- **Tắt việc tải về:** đặt `HESMAN_GRAMMARS_OFFLINE=1`, hoặc `"grammars": { "offline": true }` trong `hesman.config.json`. Khi đó Hesman không gửi yêu cầu mạng nào cho grammar; tệp thuộc các ngôn ngữ tải khi cần vẫn ở tầng text trừ khi grammar đã có sẵn trong cache.
- **Nạp sẵn cache:** `hesman grammars install scala r` hoặc `hesman grammars install --all` (46.9 MB); trên máy không có kết nối mạng, hãy chép các tệp `.wasm` sang đó và chạy `hesman grammars install --from <directory>`. `hesman grammars list` cho biết những gì đi kèm, đã cache và có thể tải. Xem [docs/CLI.md](../CLI.md#hesman-grammars).
- **Xem còn thiếu gì:** `index_status` liệt kê, theo từng ngôn ngữ, tầng của nó (`deep`, `structural` hoặc `text`), số tệp, và grammar của nó là đi kèm, đã cache hay còn thiếu, cùng lý do.

`grammars.json` còn ghim 18 grammar chưa có query symbol (Haskell, Elixir, Zig, Julia, Perl, Objective-C, Odin, Luau, Starlark, HTML, CSS, JSON, YAML, TOML, XML, Markdown, HCL, Make). Chúng có thể được cài bằng `hesman grammars install`, nhưng Hesman chưa dùng đến: tệp thuộc các ngôn ngữ đó được lập chỉ mục dưới dạng văn bản và grammar của chúng không bao giờ được tải tự động.

Ý nghĩa hiện tại của các tầng:

- **deep** — các định nghĩa (hàm, lớp, phương thức, hằng số, ...) cùng quan hệ `calls`, nhờ đó `get_callers`, `get_callees`, `get_references` và `impact_analysis` có call graph. Lời gọi được đọc từ cây cú pháp của từng ngôn ngữ (các biểu thức gọi hàm, `new X(...)`, lời gọi không có dấu ngoặc trong Ruby và Bash) và được liên kết theo tên: trước hết là tệp của chính hàm gọi, rồi đến các tệp mà nó import, thư mục của nó, và cả dự án; một tên vẫn còn mơ hồ thì được để nguyên không liên kết thay vì liên kết tới mọi ứng viên. Một lời gọi được liên kết tới định nghĩa chứ không tới khai báo không có thân (prototype C/C++, phương thức của interface hoặc phương thức trừu tượng), và `new X(...)` được liên kết tới lớp `X` chứ không tới một trong các constructor của nó. Kiểu không được phân giải, nên một phương thức được gọi trên interface có nhiều bản cài đặt sẽ không được liên kết, và một phương thức Ruby được gọi không có đối số lẫn dấu ngoặc sẽ không được nhận ra là lời gọi. Quan hệ import có cho TypeScript/JavaScript, Python, Go, C/C++ (`#include "..."`) và Ruby (`require`, `require_relative`); quan hệ `extends` / `implements` chỉ có ở những nơi ngôn ngữ viết `class X extends Y` hoặc `class X implements Y`.
- **structural** — chỉ có định nghĩa. Không còn ngôn ngữ đi kèm nào ở tầng này. Các ngôn ngữ tải khi cần thuộc tầng structural vì chỉ query symbol của upstream được dùng: không có quy tắc về tính hiển thị cho chúng (mọi định nghĩa đều được coi là exported) và không trích xuất lời gọi.
- **text** — không có symbol; xem "Text tier" trong [docs/TOOLS.md](../TOOLS.md).

Agent không cần phải biết bảng này: khi `get_callers`, `get_callees`, `get_references` hoặc `impact_analysis` được hỏi về một symbol của ngôn ngữ không có call graph, phản hồi mang theo một `note` kiểu như `call graph not available for r (symbols only)` bên cạnh danh sách rỗng, để một câu trả lời rỗng không bị hiểu nhầm thành "không có gì dùng thứ này".

Loại symbol tuân theo tags query của chính từng grammar, nên một số loại thô hơn so với ngôn ngữ: phương thức PHP và Kotlin là `function`, enum của Rust và Swift cùng interface của Kotlin là `class`, type alias của Rust là `class`. Thêm một ngôn ngữ cần một grammar, một tags query, một profile nhỏ và một mục trong registry ngôn ngữ (`src/parsers/languages.ts`) — xem [Hướng dẫn đóng góp](../CONTRIBUTING.md) để biết hướng dẫn từng bước.

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
                         │   │     3-Layer Compression Pipeline │  │
                         │   │  ┌────────────────────────────┐  │  │
                         │   │  │ 1. Compact Mode            │  │  │
                         │   │  │    Strip comments/blanks    │  │  │
                         │   │  │ 2. Context Pruning         │  │  │
                         │   │  │    Keep only relevant lines │  │  │
                         │   │  │ 3. Smart Summarization     │  │  │
                         │   │  │    planned, not applied     │  │  │
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

**Pipeline dữ liệu cốt lõi:** Thay đổi tệp (chokidar) → Tree-sitter phân tích (AST + symbol) → chỉ mục SQLite + embedding ZVec → phản hồi MCP đã nén

**Các quyết định thiết kế chính:**
- **Không phụ thuộc LSP** — Tree-sitter cung cấp khả năng phân tích cú pháp không phụ thuộc ngôn ngữ mà không cần chạy language server
- **Lập chỉ mục gia tăng theo hash nội dung** — tệp chỉ được phân tích lại khi SHA-256 thay đổi
- **Nén ở cấp phản hồi** — dữ liệu gốc được giữ nguyên vẹn; việc nén được áp dụng ở ranh giới phản hồi
- **Một cơ sở dữ liệu SQLite duy nhất cho mỗi dự án** — ngay cả trong monorepo, mọi package dùng chung một store, tách biệt theo `file_path`

Để xem tài liệu kiến trúc đầy đủ, gồm phụ thuộc giữa các module, schema của store và thiết kế worker pool, xem **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**.

---

## Thiết lập môi trường phát triển

### Điều kiện tiên quyết

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### Bắt đầu

```bash
# Clone và cài đặt
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# Tải các parser WASM của Tree-sitter
npm run download:parsers

# Chạy ở chế độ phát triển (hot reload)
npm run dev

# Build cho production
npm run build
```

### Chất lượng mã

```bash
npm run typecheck    # Kiểm tra kiểu TypeScript
npm run lint         # ESLint
npm run format       # Định dạng bằng Prettier
```

### Chạy kiểm thử

```bash
npm test                  # Chạy mọi bài test (unit + integration)
npm run test:watch        # Chế độ watch khi phát triển
npm run test:e2e          # Test end-to-end (khởi động server đầy đủ)
npm run test:perf         # Benchmark hiệu năng
```

### Mục tiêu hiệu năng

| Benchmark | Mục tiêu |
|---|---|
| Thông lượng lập chỉ mục | ≥ 500 tệp/giây |
| `find_symbol` (chính xác) | < 1ms |
| `find_symbol` (mờ) | < 5ms |
| `semantic_search` | < 10ms |
| `get_references` | < 5ms |
| Bộ nhớ (sau khi lập chỉ mục) | < 350MB |

Để xem hướng dẫn đóng góp đầy đủ, gồm cả cách thêm ngôn ngữ mới, xem **[docs/CONTRIBUTING.md](../CONTRIBUTING.md)**.

---

## Yêu cầu hệ thống

| Tài nguyên | Tối thiểu |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Bộ nhớ (khi rảnh)** | ~100 MB |
| **Bộ nhớ (khi có tải)** | ~350 MB |
| **Ổ đĩa** | ~30 MB cho gói (các grammar đi kèm), ~80 MB cho mô hình embedding (tải một lần), tối đa 47 MB cho các grammar tải khi cần nếu cài tất cả, cộng thêm chỉ mục trong `.hesman/` |
| **Mạng** | Cho việc cài đặt, cho mô hình embedding ở lần dùng đầu tiên, và cho grammar của một ngôn ngữ tải khi cần vào lần đầu một dự án có ngôn ngữ đó. Ngoài ra thì không; không có mã hay truy vấn nào được gửi đi bất cứ đâu |

Mô hình embedding (`all-MiniLM-L6-v2`) được tải về ở lần dùng đầu tiên và được cache vô thời hạn trong thư mục cache của Transformers.js.

---

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [README.md](../../README.md) | Tổng quan dự án, thiết lập và cấu hình (tệp này) |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | Kiến trúc đầy đủ: luồng dữ liệu, sơ đồ module, schema của store, thiết kế worker pool |
| [docs/CLI.md](../CLI.md) | Mọi lệnh con: `setup`, `remove`, `doctor`, `ui`, `grammars`, kèm tùy chọn và đầu ra |
| [docs/TOOLS.md](../TOOLS.md) | Schema đầu vào/đầu ra đầy đủ của cả 11 công cụ kèm ví dụ |
| [docs/CONTRIBUTING.md](../CONTRIBUTING.md) | Thiết lập môi trường phát triển, hướng dẫn kiểm thử, cách viết profile ngôn ngữ, checklist cho PR |
| [docs/SECURITY.md](../SECURITY.md) | Mô hình mối đe dọa, các lớp bảo vệ trên đầu vào của công cụ, cách báo cáo lỗ hổng |
| [CHANGELOG.md](../../CHANGELOG.md) | Lịch sử phiên bản và các thay đổi |

---

## Giấy phép

[MIT](../../LICENSE) — Copyright (c) 2026 Minh Do

Giấy phép MIT áp dụng cho phần mã được viết cho Hesman. Phần mềm của bên thứ ba giữ giấy phép riêng của nó:

- **Bên trong gói:** các grammar Tree-sitter và các tệp query, tất cả đều MIT; mỗi thứ được liệt kê cùng repository, revision và bản quyền trong [NOTICE](../../NOTICE).
- **Được npm cài làm dependency:** tất cả đều theo giấy phép dễ dãi (MIT, ISC, BSD, Apache-2.0); danh sách đầy đủ nằm trong [THIRD-PARTY-LICENSES.md](../../THIRD-PARTY-LICENSES.md). Thư viện embedding `@xenova/transformers` và vector store `@zvec/zvec` theo Apache-2.0.
- **Được tải về khi chạy:** mô hình embedding `Xenova/all-MiniLM-L6-v2` (Apache-2.0) và các grammar tải khi cần (MIT, trừ Elixir và HCL: Apache-2.0); xem [NOTICE](../../NOTICE). Dependency `sharp` của thư viện embedding cài một bản libvips dựng sẵn (LGPL-3.0-or-later) dưới dạng một thư viện dùng chung riêng biệt.
