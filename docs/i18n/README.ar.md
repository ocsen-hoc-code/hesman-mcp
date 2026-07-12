# خادم Hesman MCP

[![CI](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/do-minh/hesman-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/hesman-mcp.svg)](https://www.npmjs.com/package/hesman-mcp)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

🌐 **اقرأ هذه الوثيقة بـ:** [English](../../README.md) | [Tiếng Việt](./README.vi.md) | [Русский](./README.ru.md) | [Deutsch](./README.de.md) | [Français](./README.fr.md) | [中文](./README.zh.md) | [日本語](./README.ja.md) | [العربية](./README.ar.md) | [Español](./README.es.md) | [Português](./README.pt.md)

**Hesman** هو خادم MCP (بروتوكول سياق النموذج) من الجيل التالي يمنح وكلاء البرمجة الذكية فهماً عميقاً لقاعدة الشيفرة البرمجية الخاصة بك — الرموز، رسوم الاستدعاءات، التبعيات، والبحث الدلالي — مع خط أنابيب ضغط ثلاثي المستويات يقلل بشكل كبير من استهلاك الرموز المميزة (حتى 98% في أفضل السيناريوهات). كل شيء يعمل محلياً. لا واجهات برمجية خارجية. ولا خوادم LSP.

---

## جدول المحتويات

- [لماذا Hesman؟](#لماذا-hesman)
- [بداية سريعة](#بداية-سريعة)
- [الميزات](#الميزات)
- [كيف يعمل تقليل الرموز المميزة](#كيف-يعمل-تقليل-الرموز-المميزة)
- [التنصيب والإعداد](#التنصيب-والإعداد)
- [مرجع الأدوات](#مرجع-الأدوات)
- [الإعدادات](#الإعدادات)
- [مرجع واجهة الأوامر](#مرجع-واجهة-الأوامر)
- [اللغات المدعومة](#اللغات-المدعومة)
- [الهيكلة](#الهيكلة)
- [إعداد التطوير](#إعداد-التطوير)
- [المتطلبات](#المتطلبات)
- [التوثيق](#التوثيق)
- [الرخصة](#الرخصة)

---

## لماذا Hesman؟

وكلاء البرمجة الذكية أقوياء لكنهم مكلفون. كل سطر شيفرة يقرؤونه يكلف رموزاً مميزة. إرسال ملف كامل عندما يحتاج الوكيل فقط إلى دالة واحدة يهدر السياق والمال.

Hesman يحل هذه المشكلة عن طريق:

- **تقديم ما يحتاجه الوكيل فقط** — دالة محددة، مستدعييها، المستدعيات منها، أو الرموز المتأثرة بتغيير.
- **ضغط كل استجابة** — خط أنابيب ثلاثي المستويات يزيل التعليقات، يشذب الشيفرة غير ذات الصلة، ويلخص مجموعات النتائج الكبيرة.
- **استبدال التفريغ الخام بالملخصات** — بدلاً من 200 مرجع في مصفوفة JSON، يحصل الوكيل على كتلة `_summary` تحتوي على إحصائيات مجمعة حسب النوع والملف.
- **العمل محلياً 100%** — لا مفاتيح API، لا استدعاءات شبكة، ولا زمن وصول من خدمات خارجية. شيفرتك لا تغادر جهازك أبداً.
- **توفير قابل للقياس** — كل استجابة تتضمن `_meta.reduction` تُظهر بالضبط كم رمزاً مميزاً تم توفيره مقارنة بالمخرجات الخام.

النتيجة: وكلاء يعملون أسرع، بتكلفة أقل، وبدقة أعلى في الاستدلال لأنهم يرون الشيفرة الصحيحة، وليس كل الشيفرة.

---

## بداية سريعة

```bash
# 1. التنصيب العام
npm install -g hesman-mcp

# 2. تشغيل الخادم داخل مشروعك
cd my-project
hesman

# 3. التسجيل مع وكيل الذكاء الاصطناعي الخاص بك (Claude Desktop, Cursor, VS Code)
hesman install --agent claude
```

هذا كل شيء. بمجرد انتهاء الفهرسة الأولية (بضع ثوانٍ لمعظم المشاريع)، يمكن لوكيل الذكاء الاصطناعي الخاص بك الاستعلام عن قاعدة الشيفرة البرمجية من خلال أدوات Hesman الـ 11.

---

## الميزات

### ذكاء الشيفرة البرمجية

| الإمكانية | الوصف |
|---|---|
| **البحث عن الرموز** | إيجاد الدوال، الكلاسات، الدوالّ حسب الاسم — مطابقة تامة، ضبابية، أو بادئة (< 1 مللي ثانية) |
| **اجتياز رسم الاستدعاءات** | التنقل بين المستدعي والمستدعى حتى 3 مستويات عمقاً |
| **تتبع المراجع** | إيجاد كل استخدام لرمز عبر قاعدة الشيفرة البرمجية |
| **تحليل التأثير** | رؤية ما سينكسر إذا أعدت تسمية رمز أو حذفته أو غيرت توقيعه |
| **البحث الدلالي** | وصف ما تبحث عنه بلغة طبيعية والعثور على الشيفرة المطابقة |
| **البحث الهيكلي** | إيجاد أنماط شيفرة مثل `console.$METHOD($$$ARGS)` مع التقاطات مسماة |
| **تحليل التبعيات** | رؤية ما يستورده ملف وما يستورده منه |
| **نوافذ السياق** | الحصول على شيفرة مركزة ومضغوطة حول أي موقع في ملف |

### خط أنابيب تقليل الرموز المميزة

خط أنابيب الضغط ثلاثي المستويات في Hesman يقلل استخدام الرموز المميزة في كل استجابة. يتم قياس التوفير الفعلي والإبلاغ عنه عبر `_meta.reduction` في كل استجابة.

| المستوى | التقنية | التوفير النموذجي | أفضل حالة |
|---|---|---|---|
| **الوضع المضغوط** | يزيل التعليقات، الأسطر الفارغة، المسافات الزائدة؛ يزيل الاستيرادات غير المستخدمة | 20–35% | ~50% (شيفرة مع التعليقات بكثافة) |
| **تشذيب السياق** | يحتفظ فقط بالأسطر ذات الصلة بالرمز المطلوب؛ يستبدل الشيفرة المحذوفة بعدادات | 50–80% (فوق المضغوط) | ~95% (ملفات كبيرة بمنطقة تركيز صغيرة) |
| **التلخيص الذكي** | يستبدل مصفوفات النتائج الكبيرة بكتل `_summary` مجمعة؛ يضغط سلاسل الاستدعاءات إلى إحصائيات مجمعة | 70–90% (على أدوات القوائم) | ~98% (200+ مرجع → ملخص) |

**أفضل حالة مجمعة:** ملف من 500 سطر يتم الاستعلام عنه عبر `get_context` لدالة واحدة → يتم تشذيبه إلى ~10 أسطر ذات صلة + الوضع المضغوط → **تصل إلى 98% تقليلاً**. هذا هو السيناريو المثالي؛ الاستخدام النموذجي عبر جميع الأدوات يحقق متوسط تقليل يتراوح بين 40–70%.

### جاهز للإنتاج

- **مجموعة عاملة** — فهرسة متوازية عبر أنوية المعالج، بحجم تلقائي افتراضياً
- **مراقبة الملفات** — إعادة فهرسة تدريجية عند تغيير الملفات عبر chokidar
- **إيقاف تشغيل آمن** — يصرف الأعمال النشطة، يفرغ المخازن، ينهي العمال بنظافة
- **فهرسة ببصمة المحتوى** — يعاد تحليل الملفات فقط عندما يتغير محتواها فعلياً
- **دعم المستودعات المتعددة** — يكتشف تلقائياً pnpm، lerna، nx، turbo، و npm workspaces
- **التشخيص** — `hesman diag` يطبع الذاكرة، إحصائيات المخازن، حالة المجموعة، ومقاييس الخبء
- **مختبر في CI** — يعمل على Ubuntu، macOS، و Windows مع Node 20 و 22

---

## كيف يعمل تقليل الرموز المميزة

### المستوى 1: الوضع المضغوط

يزيل التعليقات، الأسطر الفارغة، والمسافات الزائدة مع الحفاظ على التعليقات السحرية (`// @ts-ignore`، `// eslint-disable-*`). المستوى 2 يضيف معالجة JSDoc واعية بهيكل AST وإزالة الاستيرادات غير المستخدمة.

قبل:
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

بعد (المستوى 1):
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

بعد (المستوى 2 — واعي بهيكل AST، يحتفظ بـ JSDoc فقط):
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

### المستوى 2: تشذيب السياق

عندما يستعلم وكيل عن `get_context` لرمز معين، يعيد Hesman فقط الشيفرة ذات الصلة:

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

يحافظ التشذيب على: تعريف الرمز المركّز، تعليق التوثيق الخاص به، المستدعين والمستدعيات المباشرة ضمن نفس الملف، والمراجع داخل الملف — كل شيء آخر يُستبدل بعداد.

### المستوى 3: التلخيص الذكي

بدلاً من تفريغ 200 مرجع في مصفوفة JSON:

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

يمكن للوكيل بعد ذلك طلب تفاصيل لملفات أو أنواع محددة — مع ترقيم الصفحات عبر `cursor`.

### قياس التوفير

كل استجابة من Hesman تتضمن كتلة `_meta` مع التوفير الفعلي في الرموز المميزة:

```json
{
  "_meta": {
    "originalTokens": 1250,
    "compressedTokens": 85,
    "reduction": "93.2%",
    "layers": ["compact"]
  }
}
```

هذا يسمح لك بتدقيق مقدار التوفير الذي يحققه Hesman في أعباء العمل الحقيقية الخاصة بك.

---

## التنصيب والإعداد

### المتطلبات الأساسية

- **Node.js** ≥ 20.0.0
- **npm** (أو pnpm / yarn)

### التنصيب من npm

```bash
npm install -g hesman-mcp
```

### التنصيب من المصدر

```bash
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install
npm run download:parsers   # تحميل محللات Tree-sitter WASM
npm run build              # ترجمة TypeScript
npm link                   # جعل `hesman` متاحاً بشكل عام
```

### التسجيل مع وكلاء الذكاء الاصطناعي

```bash
# Claude Desktop (يكتشف تلقائياً مسار الإعدادات حسب المنصة)
hesman install --agent claude

# Cursor
hesman install --agent cursor

# VS Code (مع Copilot أو Cline)
hesman install --agent vscode

# استخدم --global لكتابة إعدادات على مستوى المستخدم بدلاً من مستوى المشروع
hesman install --agent claude --global
```

بعد التنصيب، أعد تشغيل وكيل الذكاء الاصطناعي الخاص بك وسيكون Hesman متاحاً كخادم MCP.

### الإعداد اليدوي لـ MCP

أضف هذا إلى ملف إعدادات MCP الخاص بوكيلك:

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

## مرجع الأدوات

Hesman يوفر **11 أداة** عبر نقل stdio الخاص بـ MCP. كل استجابة تتضمن كتلة `_meta` مع توفير الرموز المميزة، وعند الاقتضاء، كتلة `_summary` تجمع النتائج.

### التنقل في الشيفرة

| الأداة | الوظيفة | المدخلات الرئيسية |
|---|---|---|
| `find_symbol` | البحث عن الرموز بالاسم مع مطابقة تامة أو ضبابية أو بادئة | `name`، `kind`، `matchMode`، `topK` |
| `get_file_structure` | الحصول على شجرة هرمية لجميع الرموز في ملف | `filePath`، `includeNested` |
| `get_references` | إيجاد جميع استخدامات رمز عبر قاعدة الشيفرة | `symbolId`، `referenceKind`، `topK`، `cursor` |
| `get_context` | الحصول على شيفرة مضغوطة حول موقع محدد | `filePath`، `startLine`، `contextLines`، `mode` |

### رسم الاستدعاءات

| الأداة | الوظيفة | المدخلات الرئيسية |
|---|---|---|
| `get_callers` | إيجاد جميع الدوال التي تستدعي رمزاً معيناً (حتى 3 مستويات عمقاً) | `symbolId`، `maxDepth`، `topK` |
| `get_callees` | إيجاد جميع الدوال التي يستدعيها رمز معين (حتى 3 مستويات عمقاً) | `symbolId`، `maxDepth`، `topK` |

### التحليل

| الأداة | الوظيفة | المدخلات الرئيسية |
|---|---|---|
| `impact_analysis` | تصنيف ما سينكسر إذا تغير رمز (إعادة تسمية/حذف/تغيير توقيع) | `symbolId`، `changeType` |
| `list_dependencies` | عرض ما يستورده ملف، أو ما يستورده منه | `filePath`، `direction` |
| `semantic_search` | البحث في الشيفرة بوصف بلغة طبيعية | `query`، `topK`، `language`، `kind` |
| `find_pattern` | البحث بنمط هيكلي مع التقاطات مسماة (`$NAME`، `$$$ARGS`) | `pattern`، `language`، `topK` |

### الحالة

| الأداة | الوظيفة |
|---|---|
| `index_status` | الإبلاغ عن صحة الفهرسة: عدد الملفات، عدد الرموز، حالة المخزن، الملفات المعلقة |

لمخططات المدخلات/المخرجات الكاملة مع الأمثلة، راجع **[docs/TOOLS.md](./docs/TOOLS.md)**.

---

## الإعدادات

أنشئ `hesman.config.json` في جذر مشروعك (جميع الحقول اختيارية):

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

### أسبقية الإعدادات

يتم حل الإعدادات بهذا الترتيب (التالي يلغي السابق):

1. **القيم الافتراضية** — مضمنة في Hesman
2. **`hesman.config.json`** — ملف إعدادات على مستوى المشروع
3. **متغيرات البيئة** — مثلاً `HESMAN_WORKERS=4`
4. **خيارات واجهة الأوامر** — مثلاً `--workers 4`

### متغيرات البيئة

| المتغير | المكافئ | الوصف |
|---|---|---|
| `HESMAN_PROJECT_ROOT` | `--project-root` | مسار المشروع المراد فهرسته |
| `HESMAN_WORKERS` | `--workers N` | عدد خيوط العمل (0 = اكتشاف تلقائي) |
| `HESMAN_LOG_LEVEL` | `--log-level` | أحد: trace، debug، info، warn، error |
| `HESMAN_DATA_DIR` | `--data-dir` | دليل بيانات الفهرسة (الافتراضي: `.hesman`) |
| `HESMAN_WATCH_MODE` | `--watch-mode` | تمكين/تعطيل مراقبة الملفات (true/false) |

### خيارات واجهة الأوامر

| الخيار | الوصف |
|---|---|
| `--project-root <path>` | دليل جذر المشروع |
| `--workers <N>` | عدد خيوط العمل (0 = تلقائي) |
| `--log-level <level>` | مستوى التسجيل |
| `--data-dir <path>` | مسار دليل البيانات |
| `--watch-mode` | تمكين مراقبة الملفات |
| `--no-watch` | تعطيل مراقبة الملفات |
| `--no-semantic` | تعطيل البحث الدلالي |
| `--batch-size <N>` | عدد الملفات لكل دفعة فهرسة |

---

## مرجع واجهة الأوامر

```
hesman                         تشغيل خادم MCP عبر stdio (الافتراضي)
hesman index [path]            فهرسة مشروع دون بدء الخادم
hesman status [path]           عرض تقدم الفهرسة والإحصائيات
hesman clean [path]            حذف دليل البيانات .hesman/
hesman clean --force           تخطي تأكيد الحذف
hesman clean --dry-run         معاينة ما سيتم حذفه دون إزالة
hesman diag [path]             طباعة التشخيصات: الذاكرة، إحصائيات المخزن، المجموعة، الخبء
hesman diag --json             إخراج التشخيصات بصيغة JSON
hesman install --agent <name>  كتابة إعدادات MCP لـ Claude Desktop أو Cursor أو VS Code
hesman install --global        كتابة إعدادات على مستوى المستخدم بدلاً من مستوى المشروع
hesman --version, -v           طباعة رقم الإصدار
hesman --help, -h              عرض نص المساعدة
```

---

## اللغات المدعومة

| اللغة | الامتدادات | الحالة |
|---|---|---|
| TypeScript / JavaScript | `.ts`، `.tsx`، `.js`، `.jsx`، `.mjs`، `.cjs`، `.mts`، `.cts` | دعم كامل |
| Python | `.py`، `.pyw`، `.pyi` | دعم كامل |
| Go | `.go` | دعم كامل |

الهيكلة تدعم حتى **158 لغة** عبر Tree-sitter. إضافة لغة جديدة تتطلب تنفيذ `LanguageProfile` — راجع [دليل المساهمة](./docs/CONTRIBUTING.md) للحصول على تعليمات خطوة بخطوة.

---

## الهيكلة

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

**خط أنابيب البيانات الأساسي:** تغييرات الملفات (chokidar) ← تحليل Tree-sitter (AST + رموز) ← فهرس SQLite + تضمينات ZVec ← استجابات MCP مضغوطة

**قرارات التصميم الرئيسية:**
- **لا اعتماد على LSP** — Tree-sitter يوفر تحليلاً مستقلاً عن اللغة دون تشغيل خوادم لغة
- **فهرسة تدريجية ببصمة المحتوى** — يعاد تحليل الملفات فقط عندما يتغير SHA-256
- **ضغط على مستوى الاستجابة** — البيانات الأصلية تبقى سليمة؛ يُطبق الضغط عند حدود الاستجابة
- **قاعدة بيانات SQLite واحدة لكل مشروع** — حتى في المستودعات المتعددة، كل الحزم تشارك مخزناً واحداً مع عزل `file_path`

لوثيقة الهيكلة الكاملة بما في ذلك تبعيات الوحدات، مخططات المخازن، وتصميم مجموعة العمال، راجع **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

---

## إعداد التطوير

### المتطلبات الأساسية

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10

### البدء

```bash
# استنساخ وتنصيب
git clone https://github.com/ocsen-hoc-code/hesman-mcp.git
cd hesman-mcp
npm install

# تحميل محللات Tree-sitter WASM
npm run download:parsers

# تشغيل في وضع التطوير (إعادة تحميل ساخنة)
npm run dev

# بناء للإنتاج
npm run build
```

### جودة الشيفرة

```bash
npm run typecheck    # التحقق من أنواع TypeScript
npm run lint         # ESLint
npm run format       # تنسيق Prettier
```

### تشغيل الاختبارات

```bash
npm test                  # تشغيل جميع الاختبارات (وحدة + تكامل)
npm run test:watch        # وضع المراقبة للتطوير
npm run test:e2e          # اختبارات شاملة (تشغيل خادم كامل)
npm run test:perf         # اختبارات الأداء
```

### أهداف الأداء

| المعيار | الهدف |
|---|---|
| إنتاجية الفهرسة | ≥ 500 ملف/ثانية |
| `find_symbol` (تام) | < 1 مللي ثانية |
| `find_symbol` (ضبابي) | < 5 مللي ثانية |
| `semantic_search` | < 10 مللي ثانية |
| `get_references` | < 5 مللي ثانية |
| الذاكرة (بعد الفهرسة) | < 350 ميجابايت |

لدليل المساهمة الكامل بما في ذلك كيفية إضافة لغات جديدة، راجع **[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)**.

---

## المتطلبات

| المورد | الحد الأدنى |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **الذاكرة (خامل)** | ~100 ميجابايت |
| **الذاكرة (تحت الحمل)** | ~350 ميجابايت |
| **القرص** | ~80 ميجابايت (تنزيل نموذج التضمين لمرة واحدة) |
| **الشبكة** | فقط لـ `npm install` الأولي؛ لا استدعاءات شبكة أثناء التشغيل |

يتم تنزيل نموذج التضمين (`all-MiniLM-L6-v2`) عند أول استخدام وتخزينه مؤقتاً إلى أجل غير مسمى في دليل خبء Transformers.js.

---

## التوثيق

| الوثيقة | المحتوى |
|---|---|
| [README.md](../../README.md) | نظرة عامة على المشروع، الإعداد، والتكوين (هذا الملف) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | الهيكلة الكاملة: تدفق البيانات، خريطة الوحدات، مخططات المخازن، تصميم مجموعة العمال |
| [docs/TOOLS.md](./docs/TOOLS.md) | مخططات المدخلات/المخرجات الكاملة لجميع الأدوات الـ 11 مع الأمثلة |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | إعداد التطوير، دليل الاختبارات، تأليف ملفات تعريف اللغة، قائمة مراجعة PR |
| [CHANGELOG.md](./CHANGELOG.md) | تاريخ الإصدارات والتغييرات |

---

## الرخصة

[MIT](./LICENSE) — حقوق النشر (c) 2026 Minh Do
