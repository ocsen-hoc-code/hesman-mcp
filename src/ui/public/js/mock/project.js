// A made-up polyglot project ("harbor-shop": a TypeScript API, a Python worker, a Go gateway)
// used by mock mode. Everything is generated deterministically from the compact tables below,
// so the mock looks the same on every load and in every test run.

/** Deterministic PRNG (mulberry32). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** 16 hex characters, like a real Hesman symbol id. */
const symbolId = (key) =>
  hash32(key, 2166136261).toString(16).padStart(8, '0') + hash32(key, 40389).toString(16).padStart(8, '0');

// path | language | symbols. Symbol: "<kind letter>:<name>"; a leading "-" marks it as not exported.
// f function, c class, m method (of the class before it), i interface, t type, e enum, k constant, v variable.
const FILE_TABLE = `
src/server.ts|typescript|f:startServer f:registerRoutes f:shutdown k:DEFAULT_PORT -f:onSignal
src/config.ts|typescript|i:AppConfig f:loadConfig f:validateConfig k:CONFIG_DEFAULTS -f:readEnv
src/telemetry/log.ts|typescript|f:logEvent f:flushEvents t:LogFields e:LogLevel -v:pendingEvents
src/telemetry/metrics.ts|typescript|c:MetricsRegistry m:increment m:observe m:snapshot f:recordLatency
src/http/router.ts|typescript|c:Router m:get m:post m:handle f:matchRoute -f:compilePattern
src/http/middleware.ts|typescript|f:withAuth f:withRateLimit f:withRequestId f:withErrorBoundary t:Middleware
src/http/errors.ts|typescript|c:HttpError c:NotFoundError c:ValidationError f:toErrorResponse f:isHttpError
src/auth/session.ts|typescript|c:SessionStore m:create m:refresh m:revoke f:parseSessionCookie f:signSession
src/auth/password.ts|typescript|f:hashPassword f:verifyPassword f:needsRehash k:HASH_ROUNDS
src/users/user-service.ts|typescript|c:UserService m:register m:findByEmail m:updateProfile m:deactivate i:User
src/users/user-routes.ts|typescript|f:handleRegister f:handleLogin f:handleLogout f:handleProfile
src/catalog/product-service.ts|typescript|c:ProductService m:listProducts m:getProduct m:searchProducts m:adjustStock i:Product
src/catalog/product-routes.ts|typescript|f:handleListProducts f:handleGetProduct f:handleSearch
src/catalog/pricing.ts|typescript|f:priceWithTax f:applyDiscount f:roundCurrency f:parsePromoCode t:Money e:DiscountKind
src/cart/cart.ts|typescript|c:Cart m:addItem m:removeItem m:updateQuantity m:total m:clear i:CartItem
src/cart/cart-service.ts|typescript|c:CartService m:loadCart m:saveCart m:mergeGuestCart f:createCart
src/cart/cart-routes.ts|typescript|f:handleGetCart f:handleAddToCart f:handleRemoveFromCart f:handleApplyPromo
src/checkout/checkout-service.ts|typescript|c:CheckoutService m:startCheckout m:confirmCheckout m:cancelCheckout f:validateCheckout i:CheckoutSession
src/checkout/payment.ts|typescript|i:PaymentGateway c:CardGateway m:authorize m:capture m:refund f:maskCardNumber
src/checkout/shipping.ts|typescript|f:quoteShipping f:pickCarrier f:estimateDelivery e:Carrier
src/checkout/checkout-routes.ts|typescript|f:handleStartCheckout f:handleConfirmCheckout f:handlePaymentWebhook
src/orders/order-service.ts|typescript|c:OrderService m:createOrder m:getOrder m:listOrders m:markShipped m:refundOrder i:Order
src/orders/order-routes.ts|typescript|f:handleListOrders f:handleGetOrder f:handleRefund
src/orders/invoice.ts|typescript|f:renderInvoice f:invoiceNumber f:formatLineItem
src/db/pool.ts|typescript|c:ConnectionPool m:acquire m:release m:drain f:createPool
src/db/query.ts|typescript|f:runQuery f:runTransaction f:buildWhere f:escapeIdentifier t:QueryResult
src/db/repository.ts|typescript|c:Repository m:findById m:findMany m:insert m:update m:remove
src/queue/publisher.ts|typescript|c:QueuePublisher m:publish m:publishBatch f:serializeJob t:Job
src/notifications/email.ts|typescript|f:sendOrderConfirmation f:sendPasswordReset f:renderTemplate f:queueEmail
src/util/retry.ts|typescript|f:retry f:backoffDelay f:withTimeout
src/util/validation.ts|typescript|f:assertEmail f:assertPositive f:assertNonEmpty f:parseInteger
web/components/CartBadge.tsx|tsx|f:CartBadge f:useCartCount
web/components/ProductCard.tsx|tsx|f:ProductCard f:formatPrice
scripts/seed.js|javascript|f:seedProducts f:seedUsers f:main
worker/main.py|python|f:main f:run_forever f:handle_job k:POLL_SECONDS
worker/jobs/email_job.py|python|c:EmailJob m:run m:render f:send_email
worker/jobs/stock_sync.py|python|c:StockSyncJob m:run m:fetch_supplier_feed f:reconcile_stock
worker/jobs/report.py|python|f:build_daily_report f:summarize_orders f:write_csv
worker/queue_client.py|python|c:QueueClient m:poll m:ack m:nack f:connect
worker/settings.py|python|c:Settings f:load_settings k:DEFAULT_QUEUE
gateway/main.go|go|f:main f:newServer f:gracefulStop
gateway/proxy.go|go|c:Proxy m:ServeHTTP m:pickBackend f:NewProxy f:copyHeaders
gateway/ratelimit.go|go|c:TokenBucket m:Allow m:refill f:NewTokenBucket
gateway/health.go|go|f:HealthHandler f:checkBackends i:Checker
gateway/config.go|go|c:Config f:LoadConfig f:envOr
`;

const KINDS = { f: 'function', c: 'class', m: 'method', i: 'interface', t: 'type', e: 'enum', k: 'constant', v: 'variable' };

/** Files without a grammar, as `index_status.textTier` reports them. */
export const TEXT_TIER = {
  files: 14,
  chunks: 41,
  languages: [
    { language: 'markdown', files: 6, chunks: 27 },
    { language: 'yaml', files: 4, chunks: 9 },
    { language: 'sql', files: 3, chunks: 4 },
    { language: 'dockerfile', files: 1, chunks: 1 },
  ],
};

function buildSymbols() {
  const symbols = [];
  for (const row of FILE_TABLE.trim().split('\n')) {
    const [filePath, language, list] = row.split('|');
    let parent = null;
    list.split(' ').forEach((entry, i) => {
      const hidden = entry.startsWith('-');
      const [letter, name] = entry.replace(/^-/, '').split(':');
      const kind = KINDS[letter];
      if (kind === 'class') parent = name;
      const startLine = 6 + i * 17;
      symbols.push({
        id: symbolId(`${filePath}#${kind === 'method' ? `${parent}.` : ''}${name}`),
        name,
        kind,
        filePath,
        startLine,
        endLine: startLine + (kind === 'constant' || kind === 'type' ? 2 : 13),
        language,
        isExported: !hidden && kind !== 'method',
        parentName: kind === 'method' ? parent : null,
      });
    });
  }
  return symbols;
}

const CALLABLE = new Set(['function', 'method']);
const dirOf = (path) => path.slice(0, path.lastIndexOf('/'));
const family = (language) => (language === 'tsx' || language === 'javascript' ? 'typescript' : language);

function buildEdges(symbols) {
  const random = prng(20261012);
  const edges = [];
  const callables = symbols.filter((s) => CALLABLE.has(s.kind));
  const hub = symbols.find((s) => s.name === 'logEvent');

  for (const from of callables) {
    const sameLanguage = callables.filter((s) => s !== from && family(s.language) === family(from.language));
    const nearby = sameLanguage.filter((s) => dirOf(s.filePath) === dirOf(from.filePath));
    const count = 1 + Math.floor(random() * 3);
    for (let i = 0; i < count; i++) {
      const pool = nearby.length > 0 && random() < 0.55 ? nearby : sameLanguage;
      const to = pool[Math.floor(random() * pool.length)];
      edges.push({ from: from.id, to: to.id, kind: 'calls', line: from.startLine + 2 + i * 3 });
    }
    // Nearly every TypeScript function reports to the telemetry hub: a realistic ~100-caller symbol.
    if (family(from.language) === 'typescript' && from !== hub && dirOf(from.filePath) !== 'src/telemetry') {
      edges.push({ from: from.id, to: hub.id, kind: 'calls', line: from.startLine + 1 });
    }
  }

  const byName = (name) => symbols.find((s) => s.name === name);
  const relate = (from, to, kind) => edges.push({ from: byName(from).id, to: byName(to).id, kind, line: byName(from).startLine });
  relate('NotFoundError', 'HttpError', 'extends');
  relate('ValidationError', 'HttpError', 'extends');
  relate('CardGateway', 'PaymentGateway', 'implements');
  relate('UserService', 'Repository', 'extends');
  relate('ProductService', 'Repository', 'extends');
  relate('OrderService', 'Repository', 'extends');
  relate('CheckoutService', 'PaymentGateway', 'imports');
  relate('CheckoutService', 'Cart', 'imports');
  relate('CartService', 'Cart', 'imports');
  relate('Cart', 'CartItem', 'imports');
  relate('OrderService', 'CheckoutSession', 'imports');
  relate('StockSyncJob', 'QueueClient', 'imports');
  relate('EmailJob', 'Settings', 'imports');
  relate('Proxy', 'TokenBucket', 'imports');
  relate('Proxy', 'Config', 'imports');
  return edges;
}

export function buildProject() {
  const symbols = buildSymbols();
  const edges = buildEdges(symbols);
  const files = [...new Set(symbols.map((s) => s.filePath))].map((filePath) => {
    const own = symbols.filter((s) => s.filePath === filePath);
    return { id: filePath, language: own[0].language, symbols: own.length };
  });
  return { symbols, edges, files, byId: new Map(symbols.map((s) => [s.id, s])) };
}

export function emptyProject() {
  return { symbols: [], edges: [], files: [], byId: new Map() };
}

/** Per-language counts as `index_status.languages` reports them, most files first. */
export function languageStats(project) {
  const stats = new Map();
  for (const file of project.files) {
    const row = stats.get(file.language) ?? { language: file.language, files: 0, symbols: 0 };
    row.files += 1;
    row.symbols += file.symbols;
    stats.set(file.language, row);
  }
  return [...stats.values()].sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}

/** File-level graph: an edge per pair of files connected by at least one relation. */
export function fileEdges(project) {
  const counts = new Map();
  for (const edge of project.edges) {
    const from = project.byId.get(edge.from).filePath;
    const to = project.byId.get(edge.to).filePath;
    if (from === to) continue;
    const key = `${from}|${to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => {
    const [from, to] = key.split('|');
    return { from, to, count };
  });
}
