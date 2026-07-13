const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const v8 = require('v8');
const { spawn, spawnSync } = require('child_process');

const { callOpenAICompatible } = require('./providers/openai_compat');
const { fetchLiveNvidiaModelGroups } = require('./providers/nvidia_models');
const { countTokens: estimateTokens } = require('./token-analyzer/counter');
const { callBedrock } = require('./providers/bedrock');
const MODELS = require('./models');
const installer = require('./install');

const AnalyticsEngine = require('./analytics/engine');
const TokenCounter = require('./token-analyzer/counter');
const PricingCalculator = require('./cost-calculator/pricing');
const ProseCompressor = require('./compression/prose-compressor');
const { OutputFilter, BUILTIN_FILTERS } = require('./output-filters/filter');
const DASHBOARD_ROUTES = require('./dashboard/routes');

const HistoryTrimmer   = require('./optimizers/history-trimmer');
const ToolCompressor   = require('./optimizers/tool-compressor');
const CacheInjector    = require('./optimizers/cache-injector');
const ToolResultFilter = require('./optimizers/tool-result-filter');
const MiddleContextCompactor = require('./optimizers/lean-context');
const LazinessOptimizer = require('./optimizers/laziness');
const ResponseStyleOptimizer = require('./optimizers/response-style');

const { SqliteStore }  = require('./cache/sqlite-store');
const ResponseCache    = require('./cache/response-cache');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH        = process.env.PROXY_MAX_CONFIG       || path.join(ROOT, 'config.json');
const LOG_DIR            = process.env.PROXY_MAX_LOG_DIR      || path.join(ROOT, 'logs');
const LOG_FILE           = path.join(LOG_DIR, 'requests.log');
const LOG_MAX_BYTES      = 10 * 1024 * 1024; // 10 MB before rotation
const LOG_KEEP_ROTATIONS = 3;                 // keep .1 .2 .3 then drop oldest
const LOG_WRITE_MODE     = String(process.env.PROXY_MAX_LOG_WRITE_MODE || 'async').toLowerCase();
const OPT_STATS_FLUSH_MS = Math.max(250, Number(process.env.PROXY_MAX_OPT_STATS_FLUSH_MS || 5000));

// Ensure log directory exists (sync at startup — cheap one-time call).
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* already exists */ }

function inferModelProfile(model = '', provider = '') {
  const m = String(model || '').toLowerCase();
  const p = String(provider || '').toLowerCase();
  const tags = new Set();
  let category = 'balanced';
  let priority = 50;
  let summary = 'Balanced general-purpose model';
  if (/haiku|mini|small|flash|lite|fast/.test(m)) { category = 'fast'; priority = 30; summary = 'Fast, cheap, simple tasks'; ['fast','cheap','simple'].forEach(t=>tags.add(t)); }
  if (/sonnet|gpt-4o|gpt-4\.1|balanced/.test(m)) { category = 'balanced'; priority = 55; summary = 'Balanced coding and general use'; ['balanced','coding','analysis'].forEach(t=>tags.add(t)); }
  if (/opus|fable|mythos|gpt-5|o[134]|reasoning|deepseek-r|qwen3|nemotron/.test(m)) { category = 'reasoning'; priority = 80; summary = 'Hard reasoning, coding, long-horizon tasks'; ['reasoning','coding','tool-heavy','analysis'].forEach(t=>tags.add(t)); }
  if (/1m|1000k|long|opus|fable|mythos|sonnet-4-6|gpt-5/.test(m)) tags.add('long-context');
  if (/vision|vl|image|4o|opus|sonnet|fable/.test(m)) tags.add('vision');
  if (/embed|embedding/.test(m)) { category = 'embedding'; priority = 5; summary = 'Embeddings only; not suitable for Claude Code chat'; tags.add('embedding'); }
  if (/azure|openai|nvidia|bedrock|cloudflare/.test(p)) tags.add(p.replace(/[^a-z0-9-]/g, ''));
  if (/kimi|glm|qwq|deepseek-r|nemotron/.test(m)) { category = 'reasoning'; priority = 80; summary = 'Hard reasoning and coding'; ['reasoning','coding','analysis'].forEach(t=>tags.add(t)); }
  if (/262k|256k|131k|128k|long/.test(m)) tags.add('long-context');
  if (/vision|scout|kimi-k2\.[67]|mistral-small/.test(m)) tags.add('vision');
  return { category, tags: [...tags], priority, summary };
}

function classifyRequestForRouting(body = {}) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const text = JSON.stringify({ system: body.system || '', messages: (body.messages || []).slice(-8), tools: tools.map(t => t.name || t.type) }).toLowerCase();
  const tags = new Set(['balanced']);
  const reasons = [];
  if (tools.length || /tool_result|tool_use|\bagent\b|bash|edit|grep|glob|read|write/.test(text)) { tags.add('tool-heavy'); tags.add('coding'); reasons.push('tools/tool history'); }
  if (/code|file|repo|git|test|build|bug|fix|refactor|typescript|javascript|python|node|server/.test(text)) { tags.add('coding'); reasons.push('coding terms'); }
  if (/analy[sz]e|research|compare|reason|plan|architecture|audit/.test(text)) { tags.add('analysis'); tags.add('reasoning'); reasons.push('analysis/reasoning terms'); }
  if (/image|screenshot|vision|pdf|document|media_type/.test(text)) { tags.add('vision'); reasons.push('vision/document content'); }
  if ((body.messages || []).length > 60 || JSON.stringify(body).length > 120000) { tags.add('long-context'); reasons.push('large context'); }
  if (!tools.length && JSON.stringify(body).length < 12000) { tags.add('fast'); reasons.push('short/no tools'); }
  return { tags: [...tags], reasons };
}

function loadConfig() {
  if (process.env.PROXY_MAX_CONFIG_JSON) {
    try { return JSON.parse(process.env.PROXY_MAX_CONFIG_JSON); }
    catch (e) { console.warn('[proxy] invalid PROXY_MAX_CONFIG_JSON:', e.message); }
  }
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { provider: null, providers: {} }; }
}
function saveConfig(cfg) {
  const data = JSON.stringify(cfg, null, 2);
  fs.writeFile(CONFIG_PATH, data, 'utf8', err => {
    if (err) console.error('[proxy] saveConfig error:', err.message);
  });
}

let CONFIG = loadConfig();

// ---- Persistent store (SQLite via node:sqlite, JSON fallback) ----
const store = new SqliteStore();
console.log(`[proxy] store backend: ${store.info().backend} (${store.info().dbFile})`);

// ---- Analytics / dashboard utilities ----
const analytics    = new AnalyticsEngine(null, store);
const tokenCounter = new TokenCounter();
const pricingCalc  = new PricingCalculator();
const compressor   = new ProseCompressor();

try {
  const currentProviderCfg = CONFIG.providers?.[CONFIG.provider] || {};
  const backfill = analytics.backfillMissingUsageAndCost?.({
    pricingCalc,
    defaultProvider: CONFIG.provider || 'unknown',
    defaultModel: currentProviderCfg.model || CONFIG.provider || 'unknown',
  });
  if (backfill?.updated) console.log(`[proxy] [analytics-backfill] updated ${backfill.updated} historical zero-cost rows`);
} catch (e) {
  console.warn('[proxy] [analytics-backfill] skipped:', e.message);
}

function estimateRequestTokens(body, provider = 'anthropic') {
  try {
    // Sum tokens over the leaves of the request rather than JSON.stringify-ing the
    // whole body (which allocated a multi-MB string for large conversations and
    // counted the outer JSON punctuation/escaping the model never sees). Prose
    // (system text, message text, tool_result content) is counted as text; tool
    // input_schema and tool_use input are counted as serialized JSON on purpose —
    // the model receives those as JSON, so their braces/keys are real tokens.
    let inputTokens = 0;
    const add = (s) => {
      if (s == null || s === '') return;
      inputTokens += tokenCounter.estimateTokens(typeof s === 'string' ? s : JSON.stringify(s), { provider });
    };

    if (typeof body?.system === 'string') add(body.system);
    else if (Array.isArray(body?.system)) for (const b of body.system) add(b?.text);

    if (Array.isArray(body?.messages)) {
      for (const m of body.messages) {
        if (typeof m?.content === 'string') { add(m.content); continue; }
        if (!Array.isArray(m?.content)) continue;
        for (const blk of m.content) {
          if (blk?.text != null) add(blk.text);
          else if (blk?.content != null) add(blk.content);   // tool_result content
          else if (blk?.input != null) add(blk.input);       // tool_use args
          else if (blk?.source?.data != null) add(blk.source.data); // image base64
        }
      }
    }

    if (Array.isArray(body?.tools)) {
      for (const t of body.tools) { add(t?.name); add(t?.description); add(t?.input_schema); }
    }

    const outputTokens = Math.max(1, Math.round(Number(body?.max_tokens || 0) * 0.08)) || 0;
    return { inputTokens, outputTokens };
  } catch {
    return { inputTokens: 0, outputTokens: 0 };
  }
}

function nonZeroUsage(usage, body, provider = 'anthropic') {
  let inputTokens = Math.max(0, Number(usage?.inputTokens) || 0);
  let outputTokens = Math.max(0, Number(usage?.outputTokens) || 0);
  const totalTokens = Math.max(0, Number(usage?.totalTokens) || 0);

  // Some providers report only total_tokens. Reconstruct missing side(s) when possible.
  if (outputTokens === 0 && inputTokens > 0 && totalTokens > inputTokens) {
    outputTokens = totalTokens - inputTokens;
  }
  if (inputTokens === 0 && outputTokens > 0 && totalTokens > outputTokens) {
    inputTokens = totalTokens - outputTokens;
  }

  const estimatedInput = inputTokens === 0;
  if (estimatedInput) inputTokens = estimateRequestTokens(body, provider).inputTokens;

  // Re-evaluate from total after input fallback.
  if (outputTokens === 0 && totalTokens > inputTokens) {
    outputTokens = totalTokens - inputTokens;
  }

  const estimatedOutput = outputTokens === 0;
  if (estimatedOutput) outputTokens = Math.max(1, Math.round(Number(body?.max_tokens || 0) * 0.08)) || 0;
  return { inputTokens, outputTokens, estimated: estimatedInput || estimatedOutput };
}

function markTiming(logEntry, name, startMs) {
  if (!logEntry) return 0;
  const ms = Date.now() - startMs;
  logEntry.timings = logEntry.timings || {};
  logEntry.timings[name] = ms;
  return ms;
}

function messageContentBlocks(msg) {
  return msg && Array.isArray(msg.content) ? msg.content.filter(Boolean) : [];
}

function requestHasToolResultHistory(body) {
  return Array.isArray(body?.messages) && body.messages.some(msg =>
    messageContentBlocks(msg).some(block => block.type === 'tool_result'));
}

function requestHasToolUseHistory(body) {
  return Array.isArray(body?.messages) && body.messages.some(msg =>
    messageContentBlocks(msg).some(block => block.type === 'tool_use' || block.type === 'server_tool_use'));
}

function isClaudeCodeToolHeavyRequest(body) {
  return !!(body?.stream && (
    (Array.isArray(body.tools) && body.tools.length > 0) ||
    requestHasToolResultHistory(body) ||
    requestHasToolUseHistory(body)
  ));
}

function validateAnthropicToolTranscript(body) {
  const availableToolUses = new Set();
  const orphanToolResults = [];
  const messages = Array.isArray(body?.messages) ? body.messages : [];

  for (let i = 0; i < messages.length; i++) {
    for (const block of messageContentBlocks(messages[i])) {
      if ((block.type === 'tool_use' || block.type === 'server_tool_use') && block.id) {
        availableToolUses.add(block.id);
      } else if (block.type === 'tool_result') {
        const id = block.tool_use_id;
        if (!id || !availableToolUses.has(id)) orphanToolResults.push({ index: i, id: id || '(missing)' });
      }
    }
  }

  return { ok: orphanToolResults.length === 0, orphanToolResults };
}
// ---- Proxy-layer optimizers (run automatically on every request) ----
const historyTrimmer = new HistoryTrimmer();
const toolCompressor = new ToolCompressor();
const cacheInjector  = new CacheInjector();
const middleContextCompactor = new MiddleContextCompactor();
const responseCache  = new ResponseCache(store);
const lazinessOptimizer = new LazinessOptimizer();
const responseStyleOptimizer = new ResponseStyleOptimizer();

function statKeyForBypassReason(reason) {
  if (!reason) return null;
  return 'responseCacheBypass' + String(reason)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function recordResponseCacheBypass(reason) {
  OPT_STATS.responseCacheBypassed++;
  const key = statKeyForBypassReason(reason || 'unknown');
  if (key) OPT_STATS[key] = (OPT_STATS[key] || 0) + 1;
}

// Drop expired cache rows hourly.
setInterval(() => { try { store.cachePrune(); } catch {} }, 60 * 60 * 1000).unref?.();
// Shared deps object threaded into every dashboard route handler.
const dashDeps = { analytics, tokenCounter, pricingCalc, compressor };

// ---- Unified optimization config ----------------------------------------
// Every cost-saving strategy is configured here and applied transparently in
// the proxy path — there is no manual copy/paste UI. Defaults are tuned to be
// safe for Claude Code (lossless or near-lossless) so they can ship enabled.
// Defaults: EVERYTHING ON, tuned conservatively ("enable everything, tuned
// safe"). Lossless stages run with zero risk; the lossy stages use gentle
// settings — a large history window, a generous tool-description cap, and the
// mildest prose mode — so they save tokens without starving Claude Code of the
// context it needs for hooks, web search, subagents and accurate tool use.
//   • cacheInject   — Anthropic prompt-cache hints; capped at the 4-breakpoint
//                     limit so it can never error. (lossless)
//   • responseCache — exact-match SQLite response cache; identical requests
//                     replay verbatim at zero upstream cost. (lossless)
//   • toolResults   — ANSI stripping on; blank-collapse/truncation off. (lossless)
//   • historyTrim   — wide 120-message window, keeps opening context. (gentle)
//   • toolCompress  — trims descriptions only past 800 chars; schemas intact. (gentle)
//   • middleContext — compacts old plain-text middle turns, never tool pairs. (gentle)
//   • compression   — 'lite' (filler words only); never touches articles/code. (gentle)
const DEFAULT_OPTIMIZATION = {
  cacheInject:   { enabled: true, ttl: '5m', minTokens: 256 },
  responseCache: { enabled: true, ttlMinutes: 60, includeStreaming: true, cacheWebSearch: false, maxBodyBytes: 2_000_000 },
  toolResults:   { enabled: true, stripAnsi: true, stripBlankLines: false, dedupeLines: false, maxChars: 0, smartFilter: true },
  historyTrim:   { enabled: true, maxMessages: 120, keepFirstN: 4, maxInputTokens: 80000 },
  toolCompress:  { enabled: false, maxDescLength: 800, stripExamples: false },
  leanContext:   { enabled: true, keepFirstN: 4, keepLastN: 24, minChars: 1200, summaryChars: 700, minSavingsTokens: 512 },
  compression:   { enabled: true, mode: 'lite' },
  laziness:      { enabled: true, mode: 'full' },
  responseStyle: { enabled: true, mode: 'full' },
};

function getOptimization() {
  const o = CONFIG.optimization || {};
  // Back-compat: fold a legacy top-level CONFIG.compression into the new shape.
  const legacyCompression = (!o.compression && CONFIG.compression) ? CONFIG.compression : null;
  return {
    compression:   { ...DEFAULT_OPTIMIZATION.compression,   ...(legacyCompression || {}), ...(o.compression   || {}) },
    toolResults:   { ...DEFAULT_OPTIMIZATION.toolResults,   ...(o.toolResults   || {}) },
    historyTrim:   { ...DEFAULT_OPTIMIZATION.historyTrim,   ...(o.historyTrim   || {}) },
    toolCompress:  { ...DEFAULT_OPTIMIZATION.toolCompress,  ...(o.toolCompress  || {}) },
    leanContext:   { ...DEFAULT_OPTIMIZATION.leanContext,   ...(o.leanContext   || {}) },
    cacheInject:   { ...DEFAULT_OPTIMIZATION.cacheInject,   ...(o.cacheInject   || {}) },
    responseCache: { ...DEFAULT_OPTIMIZATION.responseCache, ...(o.responseCache || {}) },
    laziness:      { ...DEFAULT_OPTIMIZATION.laziness,      ...(o.laziness      || {}) },
    responseStyle: { ...DEFAULT_OPTIMIZATION.responseStyle, ...(o.responseStyle || {}) },
  };
}

// Live counters surfaced on the dashboard ("savings since startup").
const OPT_STATS = {
  startedAt: Date.now(),
  requests: 0,
  toolResultsFiltered: 0,
  toolResultCharsSaved: 0,
  historyMessagesTrimmed: 0,
  toolDescCharsSaved: 0,
  leanContextTurnsCompacted: 0,
  leanContextCharsSaved: 0,
  proseCharsSaved: 0,
  cacheBreakpointsInjected: 0,
  cacheBreakpointsPreserved: 0,
  cacheBreakpointsStripped: 0,
  cacheBreakpointsUnsupported: 0,
  cacheCacheablePrefixTokens: 0,
  estTokensSaved: 0,
  responseCacheHits: 0,
  responseCacheMisses: 0,
  responseCacheStored: 0,
  responseCacheBypassed: 0,
  responseCacheTooLarge: 0,
  claudeCodeFastPathRequests: 0,
  responseCacheTokensSaved: 0,
  responseCacheCostSavedNano: 0,
  promptCacheCreationTokens: 0,
  promptCacheReadTokens: 0,
  promptCacheSavingsNano: 0,
  promptCacheWriteCostNano: 0,
  responseCacheBypassHeader: 0,
  responseCacheBypassMetadata: 0,
  responseCacheBypassClaudeCodeToolStream: 0,
  responseCacheBypassStreamingDisabled: 0,
  responseCacheBypassWebSearch: 0,
  responseCacheBypassNoKey: 0,
  fanoutQueued: 0,
  fanoutQueueTimeouts: 0,
  fanoutMaxConcurrent: 0,
  responseStyleInjections: 0,
  toolCallsSkipped: 0,
  toolCallsRepaired: 0,
};

// Restore cumulative OPT_STATS from previous runs; always reset startedAt to now.
{
  try {
    const saved = store.ready() ? store.kvGet('opt_stats') : null;
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(OPT_STATS)) {
        if (k !== 'startedAt' && typeof saved[k] === 'number') OPT_STATS[k] = saved[k];
      }
    }
  } catch {}
}

function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string' || Buffer.isBuffer(body);
  const data = isString ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isString ? (headers['Content-Type'] || 'text/plain; charset=utf-8') : 'application/json; charset=utf-8',
    ...headers
  });
  res.end(data);
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        e.raw = Buffer.concat(chunks).toString('utf8').slice(0, 2000);
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function compactText(value, maxLen = 1200) {
  if (value == null) return null;
  let text;
  if (typeof value === 'string') text = value;
  else if (Buffer.isBuffer(value)) text = value.toString('utf8');
  else {
    try { text = JSON.stringify(value); }
    catch { text = String(value); }
  }
  text = String(text).replace(/\s+/g, ' ').trim();
  if (text.length > maxLen) return `${text.slice(0, maxLen)}…`;
  return text;
}

function extractMessagePreview(content) {
  if (typeof content === 'string') return compactText(content, 400);
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const block of content) {
    if (block && block.type === 'text' && block.text) parts.push(block.text);
  }
  return parts.length ? compactText(parts.join(' '), 400) : null;
}

function summarizeRequestBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const lastMessage = messages.length ? messages[messages.length - 1] : null;
  const inputCapture = messages.slice(-6).map(m => ({
    role: m?.role || 'unknown',
    preview: extractMessagePreview(m?.content) || compactText(m?.content, 400)
  })).filter(m => m.preview);
  return {
    model: body?.model || null,
    stream: !!body?.stream,
    maxTokens: body?.max_tokens ?? null,
    messageCount: messages.length,
    toolCount: tools.length,
    hasSystem: !!body?.system,
    lastRole: lastMessage?.role || null,
    lastMessagePreview: extractMessagePreview(lastMessage?.content),
    inputCapture,
    systemPreview: body?.system ? compactText(body.system, 500) : null,
    toolNames: tools.map(t => t && t.name).filter(Boolean).slice(0, 12)
  };
}

function summarizeError(err) {
  if (!err) return null;
  const out = {
    name: err.name || 'Error',
    message: compactText(err.message || String(err), 1600)
  };
  if (err.stage) out.stage = err.stage;
  if (err.code) out.code = err.code;
  if (err.status != null) out.status = err.status;
  if (err.contentType) out.contentType = err.contentType;
  if (err.debug) out.debug = err.debug;
  return out;
}

function attachRequestTrace(res, logEntry, reqStart) {
  let finalized = false;
  const finalize = (status, extra = {}) => {
    if (finalized) return false;
    finalized = true;
    logEntry.finalStatus = status;
    logEntry.totalMs = Date.now() - reqStart;
    if (extra && typeof extra === 'object') Object.assign(logEntry, extra);
    pushLog(logEntry);
    return true;
  };
  const note = (extra = {}) => {
    if (extra && typeof extra === 'object') Object.assign(logEntry, extra);
  };
  res.__proxyTrace = { logEntry, finalize, note };
  return res.__proxyTrace;
}

function activeProviderConfig() {
  const kind = CONFIG.provider;
  if (!kind) return null;
  const p = CONFIG.providers[kind] || {};
  return { kind, ...p };
}

// ---- Model pool (round-robin + fallback) ----

let poolRR = 0;
// `${provider}::${model}` → { req, err, lastMs, consecutiveFails, cooledUntil }
const poolStats = new Map();

// Circuit breaker defaults are intentionally permissive for high-throughput
// paid deployments. A failed request should not throttle a 10M TPM pool member;
// only explicit opt-in cooldowns trip the breaker.
const POOL_BREAKER = {
  enabled: process.env.PROXY_POOL_BREAKER === '1',
  cooldown404Ms: Number(process.env.PROXY_POOL_COOLDOWN_404_MS || 0),
  cooldown429Ms: Number(process.env.PROXY_POOL_COOLDOWN_429_MS || 0),
  cooldownFailMs: Number(process.env.PROXY_POOL_COOLDOWN_FAIL_MS || 0),
  failThreshold: Math.max(1, Number(process.env.PROXY_POOL_FAIL_THRESHOLD || 10)),
};

function getOrInitStat(key) {
  if (!poolStats.has(key)) {
    poolStats.set(key, { req: 0, err: 0, lastMs: 0, consecutiveFails: 0, cooledUntil: 0 });
  }
  return poolStats.get(key);
}

function isCooledDown(stat) {
  return stat.cooledUntil > 0 && Date.now() < stat.cooledUntil;
}

function cooldownRemaining(stat) {
  return Math.max(0, Math.ceil((stat.cooledUntil - Date.now()) / 1000));
}

function getPool() {
  const raw = CONFIG.pool;
  if (!Array.isArray(raw) || raw.length === 0) {
    const cfg = activeProviderConfig();
    return cfg ? [{ ...cfg, _key: `${cfg.kind}::${cfg.model}` }] : [];
  }
  return raw.map((entry, i) => {
    const provCfg = (CONFIG.providers || {})[entry.provider] || {};
    // Per-entry credential fields (endpoint, apiKey, apiVersion, deployment, etc.)
    // override the shared provider config. This lets pool entries from the same
    // provider use different endpoints / API keys (e.g. two Azure deployments).
    const { provider, model, label, _key, ...entryOverrides } = entry;
    const endpoint = entryOverrides.endpoint || provCfg.endpoint || '';
    const deployment = entryOverrides.deployment || provCfg.deployment || '';
    const suffix = `${endpoint}|${deployment}|${i}`;
    return {
      kind: entry.provider,
      ...provCfg,
      ...entryOverrides,   // per-entry overrides win over provider defaults
      model: entry.model,
      label: entry.label || `${entry.provider} / ${entry.model}`,
      profile: entry.profile || inferModelProfile(entry.model, entry.provider),
      category: entry.category || entry.profile?.category || inferModelProfile(entry.model, entry.provider).category,
      tags: entry.tags || entry.profile?.tags || inferModelProfile(entry.model, entry.provider).tags,
      priority: entry.priority ?? entry.profile?.priority ?? inferModelProfile(entry.model, entry.provider).priority,
      _key: `${entry.provider}::${entry.model}::${suffix}`
    };
  }).filter(e => e.kind && e.model);
}

const FANOUT = {
  // Default 500: Claude Code can spin up 30+ sub-agents each with long streaming
  // responses — 200 was too easy to saturate. Upstream provider is the real throttle.
  perMember: Math.max(1, Number(process.env.PROXY_MAX_CONCURRENCY_PER_MEMBER || 500)),
  queueMs: Math.max(0, Number(process.env.PROXY_MAX_QUEUE_MS || 60000)),
};

function currentInFlight() {
  let total = 0;
  for (const s of poolStats.values()) total += s.inFlight || 0;
  return total;
}

function poolRuntimeSnapshot(pool = getPool()) {
  return pool.map(cfg => {
    const stat = getOrInitStat(cfg._key);
    return {
      key: cfg._key,
      provider: cfg.kind,
      model: cfg.model,
      label: cfg.label,
      inFlight: stat.inFlight || 0,
      queued: stat.queued || 0,
      capacity: FANOUT.perMember,
      available: Math.max(0, FANOUT.perMember - (stat.inFlight || 0)),
      req: stat.req || 0,
      err: stat.err || 0,
      lastMs: stat.lastMs || 0,
      cooldownSecsLeft: isCooledDown(stat) ? cooldownRemaining(stat) : 0,
    };
  });
}

function routeScoreForConfig(cfg, routeClass) {
  const wanted = new Set(routeClass?.tags || []);
  const have = new Set([...(cfg.tags || []), cfg.category].filter(Boolean));
  let score = Number(cfg.priority) || 0;
  for (const tag of wanted) if (have.has(tag)) score += 25;
  if (wanted.has('fast') && have.has('reasoning')) score -= 10;
  if (have.has('embedding')) score -= 1000;
  return score;
}

async function waitForPoolSlot(pool, reqId, routeClass = null) {
  const deadline = Date.now() + FANOUT.queueMs;
  let queued = false;
  while (true) {
    let best = null;
    let skipped = 0;
    for (let offset = 0; offset < pool.length; offset++) {
      const idx = (poolRR + offset) % pool.length;
      const cfg = pool[idx];
      const stat = getOrInitStat(cfg._key);
      if (isCooledDown(stat)) { skipped++; continue; }
      const inFlight = stat.inFlight || 0;
      if (inFlight >= FANOUT.perMember) continue;
      const routeScore = routeScoreForConfig(cfg, routeClass);
      if (!best || routeScore > best.routeScore || (routeScore === best.routeScore && inFlight < best.inFlight)) best = { cfg, idx, stat, inFlight, routeScore };
    }
    if (best) {
      if (queued) {
        for (const cfg of pool) {
          const s = getOrInitStat(cfg._key);
          s.queued = Math.max(0, (s.queued || 0) - 1);
        }
      }
      best.stat.inFlight = (best.stat.inFlight || 0) + 1;
      const total = currentInFlight();
      OPT_STATS.fanoutMaxConcurrent = Math.max(OPT_STATS.fanoutMaxConcurrent || 0, total);
      return { ...best, skipped };
    }
    if (FANOUT.queueMs <= 0 || Date.now() >= deadline) {
      if (queued) {
        for (const cfg of pool) {
          const s = getOrInitStat(cfg._key);
          s.queued = Math.max(0, (s.queued || 0) - 1);
        }
      }
      OPT_STATS.fanoutQueueTimeouts++;
      return { timeout: true, skipped };
    }
    if (!queued) {
      queued = true;
      OPT_STATS.fanoutQueued++;
      for (const cfg of pool) getOrInitStat(cfg._key).queued = (getOrInitStat(cfg._key).queued || 0) + 1;
      console.log(`[proxy] [fanout-queue] ${reqId} waiting for model slot (${currentInFlight()} in-flight / cap ${pool.length * FANOUT.perMember})`);
    }
    await new Promise(r => setTimeout(r, 20));
  }
}

function releasePoolSlot(stat) {
  if (!stat) return;
  stat.inFlight = Math.max(0, (stat.inFlight || 0) - 1);
}

// ---- Request log — in-memory ring buffer + rotating file ----
//
// Every completed request (ok / all-failed / mid-stream-err) is:
//   1. Pushed into REQUEST_LOG (last 300, served via GET /api/logs)
//   2. Appended as a single JSON line to logs/requests.log
//      Rotation: when the file exceeds 10 MB it is renamed to .1, old .1→.2
//      etc. up to LOG_KEEP_ROTATIONS copies; the oldest is deleted.
//
// The file survives server restarts and is readable from the VM even when
// no browser can reach the UI.

const REQUEST_LOG = [];
const MAX_LOG_ENTRIES = 300;

let _logSizeApprox = 0;       // local byte counter, avoids statSync on every flush
let _logRotateChecked = false; // ensure we check at least once after startup
function rotateLogs() {
  // Only hit the filesystem when the local counter suggests we might be near the limit.
  if (_logRotateChecked && _logSizeApprox < LOG_MAX_BYTES * 0.9) return;
  _logRotateChecked = true;
  try {
    const stat = fs.statSync(LOG_FILE);
    _logSizeApprox = stat.size;
    if (stat.size < LOG_MAX_BYTES) return;
    // Shift existing rotations: .3 → drop, .2 → .3, .1 → .2, current → .1
    for (let i = LOG_KEEP_ROTATIONS; i >= 1; i--) {
      const older = `${LOG_FILE}.${i}`;
      const newer = i < LOG_KEEP_ROTATIONS ? `${LOG_FILE}.${i + 1}` : null;
      try {
        if (newer) fs.renameSync(older, newer);
        else fs.unlinkSync(older);
      } catch { /* file may not exist yet */ }
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    _logSizeApprox = 0; // reset after rotation
  } catch { /* file doesn't exist yet — nothing to rotate */ }
}

function logLineFromEntry(entry) {
  const time = new Date(entry.ts).toISOString();
  const firstAttempt = (entry.attempts || []).find(a => a.status !== 'skipped') || {};
  return JSON.stringify({
    time,
    id:       entry.id,
    status:   entry.finalStatus,
    model:    firstAttempt.model  || '?',
    provider: firstAttempt.provider || '?',
    label:    firstAttempt.label  || '?',
    totalMs:  entry.totalMs,
    stream:   entry.stream,
    hasTools: entry.hasTools,
    hasSystem: entry.hasSystem,
    poolSize: entry.poolSize,
    fanout: entry.fanout || null,
    request: entry.request || null,
    error: entry.error || null,
    responseCapture: entry.responseCapture || null,
    attempts: (entry.attempts || []).map(a => ({
      label:      a.label,
      status:     a.status,
      durationMs: a.durationMs,
      stage:      a.stage || null,
      upstreamStatus: a.upstreamStatus ?? null,
      contentType: a.contentType || null,
      error:      a.error || null,
      responsePreview: a.responsePreview || null
    }))
  });
}

let pendingLogLines = [];
let logFlushTimer = null;
function flushLogLines() {
  const lines = pendingLogLines;
  pendingLogLines = [];
  logFlushTimer = null;
  if (!lines.length) return;
  try {
    const data = lines.join('\n') + '\n';
    _logSizeApprox += data.length;
    rotateLogs();
    fs.appendFile(LOG_FILE, data, 'utf8', e => { if (e) console.error('[proxy] [log-write-error]', e.message); });
  } catch (e) { console.error('[proxy] [log-write-error]', e.message); }
}
function writeLogLine(entry) {
  try {
    const line = logLineFromEntry(entry);
    if (LOG_WRITE_MODE === 'sync') { _logSizeApprox += line.length + 1; rotateLogs(); fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); return; }
    pendingLogLines.push(line);
    if (pendingLogLines.length >= 25) flushLogLines();
    else if (!logFlushTimer) logFlushTimer = setTimeout(flushLogLines, 250);
  } catch (e) {
    // Never let logging crash the server.
    console.error('[proxy] [log-write-error]', e.message);
  }
}

function pushLog(entry) {
  REQUEST_LOG.push(entry);
  if (REQUEST_LOG.length > MAX_LOG_ENTRIES) REQUEST_LOG.shift();
  writeLogLine(entry);
}

let optStatsDirty = false;
let optStatsTimer = null;
function markOptStatsDirty() {
  optStatsDirty = true;
  if (!optStatsTimer) optStatsTimer = setTimeout(flushOptStats, OPT_STATS_FLUSH_MS);
}
function flushOptStats() {
  optStatsTimer = null;
  if (!optStatsDirty) return;
  optStatsDirty = false;
  try { const { startedAt: _, ...s } = OPT_STATS; store.kvSet('opt_stats', s); } catch {}
}
process.once('beforeExit', () => { try { flushLogLines(); flushOptStats(); } catch {} });
process.once('SIGINT', () => { try { flushLogLines(); flushOptStats(); } finally { process.exit(130); } });
process.once('SIGTERM', () => { try { flushLogLines(); flushOptStats(); } finally { process.exit(143); } });

// ---- Rate limiting (sliding 60s window for requests + tokens) ----

const DEFAULT_LIMITS = { enabled: false, rpm: 10000, tpm: 10000000, dailyCapUsd: 0 };

function getLimits() {
  const l = CONFIG.limits || {};
  return {
    // Local limits are opt-in. If config omits `limits.enabled`, do not throttle.
    enabled: l.enabled === true,
    rpm: Number.isFinite(Number(l.rpm)) ? Number(l.rpm) : DEFAULT_LIMITS.rpm,
    tpm: Number.isFinite(Number(l.tpm)) ? Number(l.tpm) : DEFAULT_LIMITS.tpm,
    // 0/undefined = no spend cap. Modeled on LiteLLM-style budget enforcement:
    // a rolling 24h USD ceiling across the whole proxy (all keys/models/providers).
    dailyCapUsd: Number.isFinite(Number(l.dailyCapUsd)) ? Number(l.dailyCapUsd) : DEFAULT_LIMITS.dailyCapUsd
  };
}

class RateLimiter {
  constructor() { this.reqs = []; this.toks = []; }
  prune(now) {
    const cutoff = now - 60000;
    while (this.reqs.length && this.reqs[0] < cutoff) this.reqs.shift();
    while (this.toks.length && this.toks[0].ts < cutoff) this.toks.shift();
  }
  tokenSum() { return this.toks.reduce((s, t) => s + t.n, 0); }
  // Returns { ok } or { ok:false, reason, retryAfter }
  check(now, { rpm, tpm }) {
    this.prune(now);
    if (rpm > 0 && this.reqs.length >= rpm) {
      const retryAfter = Math.max(1, Math.ceil((this.reqs[0] + 60000 - now) / 1000));
      return { ok: false, reason: 'rpm', retryAfter, limit: rpm, current: this.reqs.length };
    }
    if (tpm > 0 && this.tokenSum() >= tpm) {
      const retryAfter = this.toks.length ? Math.max(1, Math.ceil((this.toks[0].ts + 60000 - now) / 1000)) : 60;
      return { ok: false, reason: 'tpm', retryAfter, limit: tpm, current: this.tokenSum() };
    }
    return { ok: true };
  }
  recordRequest(now) { this.reqs.push(now); }
  recordTokens(now, n) { if (n > 0) this.toks.push({ ts: now, n }); }
}

const limiter = new RateLimiter();

// Rolling 24h USD spend tracker, enforced independently of the rpm/tpm limiter.
class SpendTracker {
  constructor() { this.entries = []; }
  prune(now) {
    const cutoff = now - 86400000;
    while (this.entries.length && this.entries[0].ts < cutoff) this.entries.shift();
  }
  total(now) { this.prune(now); return this.entries.reduce((s, e) => s + e.usd, 0); }
  record(now, usd) { if (usd > 0) this.entries.push({ ts: now, usd }); }
}
const spendTracker = new SpendTracker();

// Tee res.write/res.end to extract real token usage from the response (works
// for both non-streaming JSON usage objects and streaming SSE message events).
function sniffUsage(res, onUsage) {
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  let buf = '';
  let reported = false;
  const scan = (chunk) => {
    if (!chunk) return;
    buf += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (buf.length > 524288) buf = buf.slice(-524288);
  };
  const lastNumber = (...names) => {
    let best = 0;
    for (const name of names) {
      const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`"${escaped}"\\s*:\\s*(\\d+)`, 'g');
      const matches = [...buf.matchAll(re)];
      if (matches.length) best = Number(matches[matches.length - 1][1]);
    }
    return best;
  };
  const detailNumber = (...names) => {
    // Some OpenAI-compatible APIs report prompt cache usage under nested detail
    // keys. Summing the last occurrence of each known detail avoids showing zero
    // when Anthropic-style cache fields are absent.
    let sum = 0;
    for (const name of names) sum += lastNumber(name);
    return sum;
  };
  const report = () => {
    if (reported) return;
    reported = true;
    const cacheRead = lastNumber('cache_read_input_tokens')
      || detailNumber('cached_tokens', 'cache_read_tokens');
    const cacheCreation = lastNumber('cache_creation_input_tokens', 'cache_creation_tokens')
      || detailNumber('cache_write_input_tokens', 'cache_write_tokens');
    const usage = {
      inputTokens: lastNumber('input_tokens', 'prompt_tokens', 'prompt_token_count', 'inputTokenCount', 'prompt_eval_count'),
      outputTokens: lastNumber('output_tokens', 'completion_tokens', 'completion_token_count', 'outputTokenCount', 'eval_count'),
      totalTokens: lastNumber('total_tokens', 'totalTokenCount'),
      cacheCreationInputTokens: cacheCreation,
      cacheReadInputTokens: cacheRead,
    };
    usage.cachedTokens = usage.cacheReadInputTokens;
    usage.totalInputTokens = usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
    onUsage(usage);
  };
  res.write = (chunk, ...a) => { scan(chunk); return origWrite(chunk, ...a); };
  res.end = (chunk, ...a) => { scan(chunk); report(); return origEnd(chunk, ...a); };
  return res;
}

// Tee res.write/res.end to accumulate the FULL response body (for the response
// cache). Caps at maxBytes — past that we give up capturing (don't cache huge
// responses) but never disturb the live stream to the client. The assembled
// buffer is exposed on res._capturedBody once res.end fires.
function captureResponse(res, maxBytes = 2_000_000) {
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const chunks = [];
  let size = 0;
  let overflow = false;
  const take = (chunk) => {
    if (overflow || !chunk) return;
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > maxBytes) { overflow = true; chunks.length = 0; return; }
    chunks.push(b);
  };
  res.write = (chunk, ...a) => { take(chunk); return origWrite(chunk, ...a); };
  res.end = (chunk, ...a) => {
    take(chunk);
    res._capturedBody = overflow ? null : Buffer.concat(chunks);
    return origEnd(chunk, ...a);
  };
  return res;
}

function setAnthropicRateLimitHeaders(res, limiterState) {
  // Always called on every /v1/messages response so Claude Code's SDK can
  // calibrate sub-agent concurrency. When local limits are disabled, report the
  // maximum generous values — the upstream provider is the real throttle.
  const limits = getLimits();
  const reportedRpm = limits.enabled ? (limits.rpm || 40000) : 40000;
  const reportedTpm = limits.enabled ? (limits.tpm || 400000000) : 400000000;
  const nowRpm = limiterState?.reqs?.length || 0;
  const nowTpm = limiterState?.tokenSum?.() || 0;
  const rpmRemaining = Math.max(0, reportedRpm - nowRpm);
  const tpmRemaining = Math.max(0, reportedTpm - nowTpm);
  const resetTime = new Date(Date.now() + 60000).toISOString();

  res.setHeader('anthropic-ratelimit-requests-limit', String(reportedRpm));
  res.setHeader('anthropic-ratelimit-requests-remaining', String(rpmRemaining));
  res.setHeader('anthropic-ratelimit-requests-reset', resetTime);
  res.setHeader('anthropic-ratelimit-tokens-limit', String(reportedTpm));
  res.setHeader('anthropic-ratelimit-tokens-remaining', String(tpmRemaining));
  res.setHeader('anthropic-ratelimit-tokens-reset', resetTime);
  res.setHeader('anthropic-ratelimit-input-tokens-limit', String(Math.floor(reportedTpm / 2)));
  res.setHeader('anthropic-ratelimit-input-tokens-remaining', String(Math.floor(tpmRemaining / 2)));
  res.setHeader('anthropic-ratelimit-input-tokens-reset', resetTime);
  res.setHeader('anthropic-ratelimit-output-tokens-limit', String(Math.floor(reportedTpm / 2)));
  res.setHeader('anthropic-ratelimit-output-tokens-remaining', String(Math.floor(tpmRemaining / 2)));
  res.setHeader('anthropic-ratelimit-output-tokens-reset', resetTime);
}

async function handleMessages(req, res) {
  const pool = getPool();
  if (pool.length === 0) {
    return send(res, 503, {
      type: 'error',
      error: { type: 'configuration_error', message: 'No models configured. Open the UI and set up a provider / model pool.' }
    });
  }

  // Enforce local rate limits before doing any upstream work.
  const limits = getLimits();
  if (limits.enabled) {
    const now = Date.now();
    const verdict = limiter.check(now, limits);
    if (!verdict.ok) {
      return send(res, 429, {
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message: `Local proxy ${verdict.reason.toUpperCase()} limit reached (${verdict.current}/${verdict.limit} in the last 60s). Retry in ${verdict.retryAfter}s.`
        }
      }, { 'retry-after': String(verdict.retryAfter) });
    }
    limiter.recordRequest(now);
  }
  if (limits.dailyCapUsd > 0) {
    const spent = spendTracker.total(Date.now());
    if (spent >= limits.dailyCapUsd) {
      return send(res, 429, {
        type: 'error',
        error: {
          type: 'budget_exceeded_error',
          message: `Proxy daily spend cap reached ($${spent.toFixed(2)}/$${limits.dailyCapUsd.toFixed(2)} in the last 24h). Raise the cap in Optimization settings or wait for the window to roll over.`
        }
      }, { 'retry-after': '3600' });
    }
  }
  // Always send rate-limit headers on every response so Claude Code's SDK can
  // calibrate sub-agent concurrency. Without these, the SDK defaults to very
  // conservative parallelism and serializes sub-agents unnecessarily.
  setAnthropicRateLimitHeaders(res, limits.enabled ? limiter : null);

  // Always sniff usage so analytics + cache savings have real token counts,
  // even when rate limiting is disabled.
  res = sniffUsage(res, (usage) => {
    if (limits.enabled) limiter.recordTokens(Date.now(), usage.inputTokens + usage.outputTokens);
    res._analyticsUsage = usage;
    res._analyticsInput = usage.inputTokens;
    res._analyticsOutput = usage.outputTokens;
    res._analyticsCached = usage.cachedTokens;
    res._analyticsCacheCreation = usage.cacheCreationInputTokens;
  });

  let body;
  try { body = await readJSONBody(req); }
  catch (err) {
    return send(res, 400, {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Bad JSON',
        detail: err.raw || err.message
      }
    });
  }

  // Claude Code sends opt-in Anthropic beta feature flags via the `anthropic-beta`
  // header (ANTHROPIC_BETAS env var, or its own default set). Stash them on the
  // body so providers that speak the native Anthropic protocol (Bedrock) can
  // forward them upstream; providers that don't understand them simply ignore
  // this internal field, same as `_requestedModel` below.
  const requestedBetas = String(req.headers['anthropic-beta'] || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (requestedBetas.length) body._requestedBetas = requestedBetas;

  const opt = getOptimization();
  const timingsStart = Date.now();
  const initialToolTranscript = validateAnthropicToolTranscript(body);
  const claudeCodeFastPath = isClaudeCodeToolHeavyRequest(body);
  const routeClass = classifyRequestForRouting(body);

  if (!initialToolTranscript.ok) {
    const preview = initialToolTranscript.orphanToolResults.slice(0, 5).map(o => `${o.id}@${o.index}`).join(', ');
    return send(res, 400, {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Invalid Anthropic tool transcript: tool_result without preceding tool_use (${preview})`
      }
    });
  }

  // ── Response cache (lossless, exact-match) ─────────────────────────────
  // Key on the ORIGINAL request (pre-optimization) so identical CLI requests
  // hit regardless of current optimization settings. A hit replays the exact
  // upstream bytes at zero upstream cost. Stream mode is part of the key.
  const requestedModelForKey = body.model || 'claude-sonnet-4-20250514';
  markTiming(null, 'noop', timingsStart);
  const hasWebSearch = (body.tools || []).some(t => String(t.name || t.type || '').includes('web_search'));
  const cacheBypassHeader = String(req.headers['x-proxy-max-cache'] || '').toLowerCase() === 'bypass';
  const cacheBypassMetadata = body.metadata && body.metadata.proxy_max_no_cache === true;
  const cacheBypassReason = !opt.responseCache.enabled ? 'disabled'
    : cacheBypassHeader ? 'header'
    : cacheBypassMetadata ? 'metadata'
    : (claudeCodeFastPath && body.stream) ? 'claude-code-tool-stream'
    : (!opt.responseCache.includeStreaming && body.stream) ? 'streaming-disabled'
    : (hasWebSearch && !opt.responseCache.cacheWebSearch) ? 'web-search'
    : null;
  let cacheKey = null;
  if (!cacheBypassReason) {
    cacheKey = responseCache.makeKey(requestedModelForKey, body, {
      optimizationVersion: 4,
      provider: pool.map(p => `${p.kind}:${p.model}:${p.endpoint || ''}`).join('|'),
      routeMode: pool.map(p => `${p.kind}:${p.kind === 'azure' && /gpt-5|responses/i.test(String(p.model || p.deployment || '')) ? 'responses' : (p.kind === 'bedrock' ? 'native' : 'chat')}`).join('|'),
      cachePolicy: {
        includeStreaming: opt.responseCache.includeStreaming !== false,
        cacheWebSearch: opt.responseCache.cacheWebSearch === true,
      },
    });
    const hit = cacheKey ? responseCache.get(cacheKey) : null;
    if (hit) {
      OPT_STATS.responseCacheHits++;
      let savedTokens = (hit.inputTokens || 0) + (hit.outputTokens || 0);
      if (!savedTokens) {
        const est = estimateRequestTokens(body, 'anthropic');
        hit.inputTokens = est.inputTokens;
        hit.outputTokens = est.outputTokens;
        savedTokens = est.inputTokens + est.outputTokens;
      }
      OPT_STATS.responseCacheTokensSaved += savedTokens;
      const costSaved = pricingCalc.calculateCostNano(hit.inputTokens || 0, hit.outputTokens || 0, hit.model || requestedModelForKey);
      OPT_STATS.responseCacheCostSavedNano += costSaved?.cost_nano_usd || 0;
      // Record a zero-cost cache-hit request for the dashboard.
      try {
        analytics.logRequest({
          provider: 'cache', model: requestedModelForKey,
          inputTokens: hit.inputTokens || 0, outputTokens: hit.outputTokens || 0,
          cachedTokens: savedTokens, costNanoUsd: 0,
          compressionMode: 'response-cache', responseTimeMs: 0, status: 'cache_hit'
        });
        markOptStatsDirty();
      } catch {}
      // Build a fresh log entry for the hit.
      pushLog({
        id: Math.random().toString(36).slice(2, 10), ts: Date.now(),
        request: summarizeRequestBody(body), stream: !!body.stream,
        hasTools: !!(body.tools && body.tools.length), hasSystem: !!body.system,
        poolSize: 0, finalStatus: 'cache-hit', totalMs: 0,
        responseCapture: compactText(hit.body, 1400),
        attempts: [{ label: 'response-cache', provider: 'cache', model: requestedModelForKey, status: 'ok', durationMs: 0, responsePreview: compactText(hit.body, 900) }]
      });
      console.log(`[proxy] [cache-hit] ${requestedModelForKey} saved ~${savedTokens} tokens`);
      res.writeHead(200, { 'Content-Type': hit.contentType || 'application/json' });
      return res.end(hit.body);
    }
    if (!cacheKey) recordResponseCacheBypass('no-key');
    else OPT_STATS.responseCacheMisses++;
    // On a miss, capture the full upstream response so we can store it on success.
    res = captureResponse(res, Math.max(1, Number(opt.responseCache.maxBodyBytes) || 2_000_000));
  } else if (opt.responseCache.enabled) {
    recordResponseCacheBypass(cacheBypassReason);
    res._responseCacheBypassReason = cacheBypassReason;
  }

  // ── Proxy-layer optimization pipeline ──────────────────────────────────
  // Runs automatically on every request. Each stage is independently gated by
  // CONFIG.optimization and tracked for savings. Ordering matters: filter and
  // trim before measuring, compress prose last, inject cache breakpoints per
  // provider (handled later in sanitizeBodyForProvider for Bedrock).
  const optApplied = [];     // human-readable list of stages that fired
  let optEstTokensSaved = 0; // rough estimate (~4 chars / token)
  let messagesMutated = false; // set by EVERY stage that changes message content or
                               // structure (reassigns body.messages OR edits a block
                               // in place). The final transcript re-validation only
                               // runs when this is true; any new message-mutating
                               // stage MUST set it or the orphan-transcript guard is
                               // silently skipped.
  OPT_STATS.requests++;
  if (claudeCodeFastPath) OPT_STATS.claudeCodeFastPathRequests++;

  // Stage 1 — Filter verbose tool_result blocks (strip ANSI, blank lines, cap size).
  if (opt.toolResults.enabled && Array.isArray(body.messages)) {
    const trf = new ToolResultFilter({
      stripAnsi:       opt.toolResults.stripAnsi,
      stripBlankLines: opt.toolResults.stripBlankLines,
      maxChars:        opt.toolResults.maxChars,
      dedupeLines:     opt.toolResults.dedupeLines,
      smartFilter:     opt.toolResults.smartFilter !== false,
    });
    const r = trf.filterMessages(body.messages);
    if (r.savedChars > 0) {
      body.messages = r.messages;
      messagesMutated = true;
      OPT_STATS.toolResultsFiltered += r.filteredCount;
      OPT_STATS.toolResultCharsSaved += r.savedChars;
      optEstTokensSaved += r.savedChars / 4;
      optApplied.push(`tool-results(-${r.savedChars}c)`);
    }
  }

  // Stage 2 — Sliding-window history trim.
  if (opt.historyTrim.enabled && Array.isArray(body.messages) && !claudeCodeFastPath) {
    const beforeTrimMessages = body.messages;
    const r = historyTrimmer.trim(body.messages, {
      maxMessages:    opt.historyTrim.maxMessages,
      keepFirstN:     opt.historyTrim.keepFirstN,
      maxInputTokens: opt.historyTrim.maxInputTokens || 80000,
    });
    if (r.trimmed > 0) {
      body.messages = r.messages;
      const afterTrimTranscript = validateAnthropicToolTranscript(body);
      if (!afterTrimTranscript.ok) {
        // Never let a token-saving optimization create a malformed tool loop.
        body.messages = beforeTrimMessages;
        optApplied.push('history-skip(tool-pairs)');
      } else {
        messagesMutated = true;
        OPT_STATS.historyMessagesTrimmed += r.trimmed;
        // Estimate ~250 tokens per dropped message (conservative).
        optEstTokensSaved += r.trimmed * 250;
        optApplied.push(`history(-${r.trimmed}msg)`);
      }
    }
  } else if (opt.historyTrim.enabled && claudeCodeFastPath) {
    optApplied.push('history-skip(claude-code)');
  }

  // Stage 3 — Compress verbose tool descriptions.
  if (opt.toolCompress.enabled && Array.isArray(body.tools) && !claudeCodeFastPath) {
    const r = toolCompressor.compress(body.tools, {
      maxDescLength: opt.toolCompress.maxDescLength,
      stripExamples: opt.toolCompress.stripExamples,
    });
    if (r.savedChars > 0) {
      body.tools = r.tools;
      OPT_STATS.toolDescCharsSaved += r.savedChars;
      optEstTokensSaved += r.savedChars / 4;
      optApplied.push(`tool-defs(-${r.savedChars}c)`);
    }
  }

  // Stage 4 — middle context compaction shortens older plain-text turns while
  // preserving recent/tool history exactly. Keep it enabled for Claude Code too
  // because it avoids tool blocks and newest turns.
  if (opt.leanContext.enabled && Array.isArray(body.messages)) {
    const beforeLeanMessages = body.messages;
    const r = middleContextCompactor.compact(body.messages, opt.leanContext);
    if (r.savedChars > 0) {
      body.messages = r.messages;
      const leanTranscript = validateAnthropicToolTranscript(body);
      if (!leanTranscript.ok) {
        body.messages = beforeLeanMessages;
        optApplied.push('middle-context-skip(tool-pairs)');
      } else {
        messagesMutated = true;
        OPT_STATS.leanContextTurnsCompacted += r.compacted;
        OPT_STATS.leanContextCharsSaved += r.savedChars;
        optEstTokensSaved += r.savedChars / 4;
        optApplied.push(`middle-context(-${r.compacted}turn/${r.savedChars}c)`);
      }
    }
  }

  // Stage 5 — Prose compression of system prompt + message text blocks.
  if (opt.compression.enabled && !claudeCodeFastPath) {
    const compMode = opt.compression.mode || 'lite';
    let proseSaved = 0;
    if (body.system && typeof body.system === 'string') {
      const before = body.system.length;
      body.system = compressor.compress(body.system, compMode);
      proseSaved += Math.max(0, before - body.system.length);
    }
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block && block.type === 'text' && typeof block.text === 'string') {
              const before = block.text.length;
              block.text = compressor.compress(block.text, compMode);
              proseSaved += Math.max(0, before - block.text.length);
            }
          }
        }
      }
    }
    body._compressionMode = compMode;
    if (proseSaved > 0) {
      messagesMutated = true;
      OPT_STATS.proseCharsSaved += proseSaved;
      optEstTokensSaved += proseSaved / 4;
      optApplied.push(`prose:${compMode}(-${proseSaved}c)`);
    }
  }

  // Stage 6 — Laziness Rules
  // Skip when tools are present — terse-style injections cause the model to emit empty input:{} on tool calls
  if (opt.laziness.enabled && !claudeCodeFastPath && !(body.tools && body.tools.length)) {
    const p = lazinessOptimizer.inject(body, { mode: opt.laziness.mode });
    if (p.injected) {
      OPT_STATS.lazinessInjections = (OPT_STATS.lazinessInjections || 0) + 1;
      optApplied.push(`laziness:${p.mode}`);
    }
  }

  // Stage 7 — Response Style (caveman mode) — terse output injection
  // Skip when tools are present — terse-style injections cause the model to emit empty input:{} on tool calls
  if (opt.responseStyle && opt.responseStyle.enabled && !claudeCodeFastPath && !(body.tools && body.tools.length)) {
    const p = responseStyleOptimizer.inject(body, { mode: opt.responseStyle.mode });
    if (p.injected) {
      OPT_STATS.responseStyleInjections = (OPT_STATS.responseStyleInjections || 0) + 1;
      optApplied.push(`response-style:${p.mode}`);
    }
  }

  // Stage 8 — Native max_tokens Intercept
  // If the model gets cut off while writing a file, Claude Code emits an InputValidationError.
  // We rewrite it to explicitly warn the model about the output limit so it switches to Edit.
  if (Array.isArray(body.messages)) {
    const lastMsg = body.messages[body.messages.length - 1];
    if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
      for (const block of lastMsg.content) {
        if (block.type === 'tool_result' && block.content && typeof block.content === 'string') {
          if (block.content.includes('InputValidationError: Write failed') && block.content.includes('The required parameter `content` is missing')) {
            block.content = block.content.replace(
              '</tool_use_error>',
              '\n\nCRITICAL SYSTEM WARNING: You hit the maximum output token limit because the file is too large! DO NOT attempt to use the Write tool again for this file. You MUST use the Edit tool or bash commands to modify this file incrementally.</tool_use_error>'
            );
            messagesMutated = true;
          }
        }
      }
    }
  }

  optEstTokensSaved = Math.round(optEstTokensSaved);
  OPT_STATS.estTokensSaved += optEstTokensSaved;
  // The request was already validated at entry (line ~909). Only re-validate if a
  // stage actually rewrote body.messages — otherwise the transcript is unchanged
  // and re-walking every message is pure overhead on the hot path.
  if (messagesMutated) {
    const finalToolTranscript = validateAnthropicToolTranscript(body);
    if (!finalToolTranscript.ok) {
      const preview = finalToolTranscript.orphanToolResults.slice(0, 5).map(o => `${o.id}@${o.index}`).join(', ');
      return send(res, 400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: `Proxy optimization produced an invalid Anthropic tool transcript (${preview}); refusing to forward upstream.`
        }
      });
    }
  }

  body._optApplied = optApplied;
  body._optEstTokensSaved = optEstTokensSaved;
  body._cacheInject = opt.cacheInject.enabled;
  body._cacheInjectOptions = { ttl: opt.cacheInject.ttl === '1h' ? '1h' : '5m', minTokens: opt.cacheInject.minTokens || 256 };
  body._claudeCodeFastPath = claudeCodeFastPath;

  // Build log entry for this request.
  const reqId = Math.random().toString(36).slice(2, 10);
  const logEntry = {
    id: reqId,
    ts: Date.now(),
    request: summarizeRequestBody(body),
    stream: !!body.stream,
    maxTokens: body.max_tokens || null,
    messageCount: (body.messages || []).length,
    hasTools: !!(body.tools && body.tools.length),
    hasSystem: !!body.system,
    claudeCodeFastPath,
    routeClass,
    poolSize: pool.length,
    fanout: { capacity: pool.length * FANOUT.perMember, perMember: FANOUT.perMember, queueMs: FANOUT.queueMs },
    timings: {},
    attempts: [],
    finalStatus: 'ok',
    totalMs: 0
  };
  const reqStart = Date.now();
  attachRequestTrace(res, logEntry, reqStart);

  // Strip cache_control from providers that don't support it, and reject
  // computer-use tools for providers other than Bedrock.
  function sanitizeBodyForProvider(b, cfg) {
    const kind = cfg.kind;
    const out = { ...b };

    // OpenAI-compatible providers don't support Anthropic cache_control — strip it
    // from all content blocks so Azure/Foundry/NVIDIA don't reject the request.
    if (kind === 'nvidia' || kind === 'azure') {
      const stripped = cacheInjector.strip(out);
      Object.assign(out, stripped.body);
      if (stripped.stripped > 0) {
        OPT_STATS.cacheBreakpointsStripped += stripped.stripped;
        OPT_STATS.cacheBreakpointsUnsupported += stripped.stripped;
      }
    }

    // Detect computer-use tools — only Bedrock supports them.
    const hasComputerUse = (out.tools || []).some(t => t.type && t.type.startsWith('computer_'));
    if (hasComputerUse && kind !== 'bedrock') {
      throw Object.assign(
        new Error(`Computer-use tools are not supported by provider "${kind}". Use AWS Bedrock.`),
        { status: 400, stage: 'validation' }
      );
    }

    // Inject Anthropic prompt-cache breakpoints (Bedrock is the only Anthropic-
    // native path here). Cache hits on the system prompt + tool definitions cost
    // ~10% of normal input — the single biggest lever for Claude Code sessions.
    if (kind === 'bedrock' && b._cacheInject) {
      const r = cacheInjector.inject(out, kind, b._cacheInjectOptions || {});
      Object.assign(out, r.body);
      OPT_STATS.cacheBreakpointsInjected += r.injected || 0;
      OPT_STATS.cacheBreakpointsPreserved += r.preserved || 0;
      OPT_STATS.cacheCacheablePrefixTokens += r.cacheablePrefixTokens || 0;
    }

    return out;
  }

  // Fan-out scheduler + fallback with circuit breaker.
  // Claude Code can spawn many parallel subagents; queue briefly when every
  // pool member is saturated instead of stampeding one Azure deployment.
  let tried = 0; // members actually called (not skipped)
  let skipped = 0;
  let acquiredSlot = null;

  // Preserve the model name the CLI originally requested (e.g. "claude-opus-4-8").
  // The proxy overwrites body.model with the real upstream model for each attempt,
  // but the *response* must echo back the requested name so the Claude CLI doesn't
  // detect a non-Claude model and fall into degraded/simulation mode.
  const requestedModel = body.model || 'claude-sonnet-4-20250514';

  for (let attempt = 0; attempt < pool.length; attempt++) {
    const slot = attempt === 0
      ? await waitForPoolSlot(pool, reqId, routeClass)
      : (() => {
          for (let offset = 0; offset < pool.length; offset++) {
            const idx = (poolRR + offset) % pool.length;
            const cfg = pool[idx];
            const stat = getOrInitStat(cfg._key);
            if (isCooledDown(stat)) continue;
            stat.inFlight = (stat.inFlight || 0) + 1;
            return { cfg, idx, stat, skipped: 0 };
          }
          return { timeout: true, skipped: pool.length };
        })();
    skipped += slot.skipped || 0;
    if (slot.timeout) {
      logEntry.finalStatus = 'queued-timeout';
      logEntry.totalMs = Date.now() - reqStart;
      logEntry.fanout = { inFlight: currentInFlight(), capacity: pool.length * FANOUT.perMember, perMember: FANOUT.perMember, queueMs: FANOUT.queueMs };
      pushLog(logEntry);
      return send(res, 429, {
        type: 'error',
        error: { type: 'rate_limit_error', message: `Proxy model pool is saturated (${currentInFlight()}/${pool.length * FANOUT.perMember} in-flight). Increase pool size or PROXY_MAX_CONCURRENCY_PER_MEMBER.` }
      }, { 'retry-after': '1' });
    }

    const { cfg, idx, stat } = slot;
    acquiredSlot = stat;
    const key = cfg._key;

    tried++;
    body.model = cfg.model;
    body._requestedModel = requestedModel;
    stat.req++;
    const t0 = Date.now();
    logEntry.timings.routeSelectMs = Date.now() - reqStart;

    const attemptLog = {
      model: cfg.model,
      provider: cfg.kind,
      label: cfg.label,
      endpoint: cfg.endpoint || null,
      status: 'ok',
      durationMs: 0,
      error: null
    };

    try {
      const sanitizedBody = sanitizeBodyForProvider(body, cfg);
      const upstreamStart = Date.now();
      if (cfg.kind === 'bedrock') await callBedrock(cfg, sanitizedBody, res);
      else await callOpenAICompatible(cfg, sanitizedBody, res);
      attemptLog.upstreamMs = Date.now() - upstreamStart;
      releasePoolSlot(acquiredSlot);
      acquiredSlot = null;
      attemptLog.durationMs = Date.now() - t0;
      attemptLog.routeScore = routeScoreForConfig(cfg, routeClass);
      stat.lastMs = attemptLog.durationMs;
      stat.consecutiveFails = 0;
      stat.cooledUntil = 0;
      poolRR = (idx + 1) % pool.length;
      logEntry.attempts.push(attemptLog);
      logEntry.totalMs = Date.now() - reqStart;
      if (res._capturedBody) logEntry.responseCapture = compactText(res._capturedBody, 1400);
      // Capture tool-call repair events (skipped truncated calls, repaired JSON).
      // _toolRepairs is written by createAnthropicSSEEmitter (streaming) and
      // buildAnthropicResponse (non-streaming) when arg repair fires.
      const toolRepairs = res._toolRepairs;
      if (toolRepairs && toolRepairs.length) {
        logEntry.toolRepairs = toolRepairs;
        let skipped = 0, repaired = 0;
        for (const r of toolRepairs) {
          if (r.status === 'skipped') skipped++;
          else if (r.status === 'repaired') repaired++;
        }
        if (skipped) OPT_STATS.toolCallsSkipped += skipped;
        if (repaired) OPT_STATS.toolCallsRepaired += repaired;
        markOptStatsDirty();
        const summary = toolRepairs.map(r => `${r.tool}:${r.status}(${r.rawLen}b)`).join(', ');
        console.warn(`[proxy] [tool-repair] req=${reqId} provider=${cfg.kind} ${summary}`);
      }
      pushLog(logEntry);
      // Log analytics after success. Token counts come from the sniffUsage
      // callback which fires on res.end(); we use setImmediate to ensure it
      // has already fired before we read the values.
      setImmediate(() => {
        try {
          const usage = res._analyticsUsage || {};
          const measured = nonZeroUsage(usage, body, cfg.kind === 'bedrock' ? 'anthropic' : 'openai');
          const inputTokens = measured.inputTokens;
          const outputTokens = measured.outputTokens;
          if (measured.estimated && store.cacheBackfillTokens) {
            const filled = store.cacheBackfillTokens({ inputTokens, outputTokens, provider: cfg.kind, model: cfg.model });
            if (filled) console.log(`[proxy] [cache-backfill] filled ${filled} zero-token cache entries with current estimate ${inputTokens}+${outputTokens}`);
          }
          const cacheReadTokens = usage.cacheReadInputTokens || 0;
          const cacheCreateTokens = usage.cacheCreationInputTokens || 0;
          // Anthropic prompt-cache usage fields are separate: inputTokens is the
          // uncached remainder, while total context input also includes read/write
          // cache spans. Azure/OpenAI usually reports only prompt_tokens, so these
          // cache fields stay zero there.
          const totalInputTokens = inputTokens + cacheReadTokens + cacheCreateTokens;
          const billableInputTokens = totalInputTokens;
          const costResult = pricingCalc.calculateCostNano(inputTokens, outputTokens, cfg.model, {
            cachedTokens: cacheReadTokens,
            cacheCreationTokens: cacheCreateTokens,
          });
          if (costResult?.cost_nano_usd) spendTracker.record(Date.now(), costResult.cost_nano_usd / 1e9);
          if (cacheReadTokens || cacheCreateTokens) {
            OPT_STATS.promptCacheReadTokens += cacheReadTokens;
            OPT_STATS.promptCacheCreationTokens += cacheCreateTokens;
            OPT_STATS.promptCacheSavingsNano += costResult?.prompt_cache_savings_nano || 0;
            OPT_STATS.promptCacheWriteCostNano += costResult?.prompt_cache_write_nano || 0;
          }
          // Record optimizer savings so the dashboard's tokens-saved / cost-saved
          // figures reflect the proxy-layer work. original = what we *would* have
          // sent; compressed = what we actually sent.
          const saved = body._optEstTokensSaved || 0;
          const actualTokens = inputTokens + outputTokens;
          analytics.logRequest({
            provider: cfg.kind,
            model: cfg.model,
            inputTokens,
            outputTokens,
            cachedTokens: cacheReadTokens,
            cacheCreationInputTokens: cacheCreateTokens,
            billableInputTokens,
            totalInputTokens,
            costNanoUsd: costResult?.cost_nano_usd || 0,
            compressionMode: (body._optApplied && body._optApplied.length)
              ? (body._compressionMode || 'optimized')
              : 'none',
            originalTokenCount: actualTokens + saved,
            compressedTokenCount: actualTokens,
            responseTimeMs: attemptLog.durationMs,
            status: 'success',
            upstream: { cacheCreationInputTokens: cacheCreateTokens, cacheReadInputTokens: cacheReadTokens, usageEstimated: measured.estimated, pricingEstimated: !!costResult?.pricing_estimated }
          });
          markOptStatsDirty();

          // Store the captured response in the lossless cache (success only).
          if (opt.responseCache.enabled && cacheKey) {
            if (res._capturedBody && res._capturedBody.length > 0) {
              const ttlMs = Math.max(0, (Number(opt.responseCache.ttlMinutes) || 0) * 60 * 1000);
              responseCache.set(cacheKey, {
                body: res._capturedBody,
                contentType: res.getHeader ? (res.getHeader('content-type') || 'application/json') : 'application/json',
                inputTokens, outputTokens, ttlMs,
                provider: cfg.kind, model: requestedModel, stream: !!body.stream,
              });
              console.log(`[proxy] [cache-store] ${requestedModel} key=${String(cacheKey).slice(0, 12)} bytes=${res._capturedBody.length} ttl=${Math.round(ttlMs / 60000)}m`);
              OPT_STATS.responseCacheStored++;
            } else if (res._capturedBody === null) {
              OPT_STATS.responseCacheTooLarge++;
            }
          }
        } catch (e) {
          console.error('[proxy] [analytics] logRequest error:', e.message);
        }
      });
      console.log(`[proxy] [ok] ${cfg.label} dur=${attemptLog.durationMs}ms stream=${body.stream}`);
      return;
    } catch (err) {
      releasePoolSlot(acquiredSlot);
      acquiredSlot = null;
      attemptLog.durationMs = Date.now() - t0;
      attemptLog.status = 'err';
      attemptLog.error = compactText(err.message, 400);
      if (err.stage) attemptLog.stage = err.stage;
      if (err.status != null) attemptLog.upstreamStatus = err.status;
      if (err.contentType) attemptLog.contentType = err.contentType;
      if (err.debug?.responsePreview) attemptLog.responsePreview = err.debug.responsePreview;
      if (err.debug?.responseBody) attemptLog.responsePreview = err.debug.responseBody;
      if (err.debug?.requestPreview && !logEntry.requestPreview) logEntry.requestPreview = err.debug.requestPreview;
      stat.err++;
      stat.lastMs = attemptLog.durationMs;
      stat.consecutiveFails = (stat.consecutiveFails || 0) + 1;

      // Circuit breaker: disabled by default so transient upstream/request errors
      // never throttle high-TPM deployments. Set PROXY_POOL_BREAKER=1 to enable
      // opt-in cooldown behavior for fragile or low-quota pools.
      const is404 = /Upstream 4[0-9]{2}/.test(err.message) && err.message.includes('404');
      const is429 = /Upstream 429/.test(err.message) || (err.status === 429);
      if (is429) stat.consecutiveFails = Math.max(0, (stat.consecutiveFails || 0) - 1);
      if (POOL_BREAKER.enabled) {
        if (is404 && POOL_BREAKER.cooldown404Ms > 0) {
          stat.cooledUntil = Date.now() + POOL_BREAKER.cooldown404Ms;
          console.warn(`[proxy] [breaker] ${cfg.label} → 404, cooldown ${Math.ceil(POOL_BREAKER.cooldown404Ms / 1000)}s`);
        } else if (is429 && POOL_BREAKER.cooldown429Ms > 0) {
          stat.cooledUntil = Date.now() + POOL_BREAKER.cooldown429Ms;
          console.warn(`[proxy] [breaker] ${cfg.label} → 429, cooldown ${Math.ceil(POOL_BREAKER.cooldown429Ms / 1000)}s`);
        } else if (!is429 && stat.consecutiveFails >= POOL_BREAKER.failThreshold && POOL_BREAKER.cooldownFailMs > 0) {
          stat.cooledUntil = Date.now() + POOL_BREAKER.cooldownFailMs;
          console.warn(`[proxy] [breaker] ${cfg.label} → ${stat.consecutiveFails} consecutive fails, cooldown ${Math.ceil(POOL_BREAKER.cooldownFailMs / 1000)}s`);
        }
      }

      logEntry.attempts.push(attemptLog);

      if (res.headersSent) {
        if (res.__proxyTrace) {
          res.__proxyTrace.finalize('mid-stream-err', {
            error: summarizeError(err),
            request: logEntry.request,
            attempt: attemptLog
          });
        } else {
          logEntry.finalStatus = 'mid-stream-err';
          logEntry.totalMs = Date.now() - reqStart;
          pushLog(logEntry);
        }
        console.error(`[proxy] [mid-stream] ${reqId} ${cfg.label}: ${err.message}`);
        try { res.end(); } catch {}
        return;
      }

      const remaining = pool.length - attempt - 1;
      if (remaining > 0) {
        console.warn(`[proxy] [fallback] ${cfg.label} failed → trying next (${remaining} left)`);
      } else {
        logEntry.finalStatus = tried > 0 ? 'all-failed' : 'all-skipped';
        logEntry.totalMs = Date.now() - reqStart;
        pushLog(logEntry);
        const msg = tried === 0
          ? `All ${pool.length} pool members are in circuit-breaker cooldown. Try again later.`
          : `All pool members failed. Last error: ${err.message}`;
        console.error(`[proxy] [${logEntry.finalStatus}] ${reqId} ${msg}`);
        send(res, 502, { type: 'error', error: { type: 'api_error', message: msg } });
      }
    }
  }

  // Edge case: every member was skipped (all in cooldown, none tried).
  if (tried === 0 && skipped > 0) {
    logEntry.finalStatus = 'all-skipped';
    logEntry.totalMs = Date.now() - reqStart;
    pushLog(logEntry);
    send(res, 503, {
      type: 'error',
      error: { type: 'api_error', message: `All ${skipped} pool members are in circuit-breaker cooldown. Try again later.` }
    });
  }
}

async function handleCountTokens(req, res) {
  try {
    const body = await readJSONBody(req);
    const tokens = tokenCounter.estimateTokens(JSON.stringify(body), { provider: 'anthropic' });
    setAnthropicRateLimitHeaders(res, null);
    send(res, 200, { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  } catch (err) {
    send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: err.message } });
  }
}

function handleConfigGet(_req, res) {
  // Redact secrets in responses.
  const safe = JSON.parse(JSON.stringify(CONFIG));
  for (const k of Object.keys(safe.providers || {})) {
    const p = safe.providers[k];
    if (p.apiKey) p.apiKey = '••••' + p.apiKey.slice(-4);
    if (p.secretAccessKey) p.secretAccessKey = '••••' + p.secretAccessKey.slice(-4);
  }
  send(res, 200, { ...safe, configPath: CONFIG_PATH });
}

async function handleConfigPost(req, res) {
  const body = await readJSONBody(req);
  // Body shape: { provider: 'bedrock'|'azure'|'nvidia', config: {...} }
  if (!body.provider) return send(res, 400, { error: 'provider required' });
  CONFIG.provider = body.provider;
  CONFIG.providers = CONFIG.providers || {};
  const prev = CONFIG.providers[body.provider] || {};
  const incoming = body.config || {};
  // If apiKey/secret comes back as the masked string, keep the previous value.
  const merged = { ...prev, ...incoming };
  if (typeof incoming.apiKey === 'string' && incoming.apiKey.startsWith('••••')) merged.apiKey = prev.apiKey;
  if (typeof incoming.secretAccessKey === 'string' && incoming.secretAccessKey.startsWith('••••')) merged.secretAccessKey = prev.secretAccessKey;
  CONFIG.providers[body.provider] = merged;
  saveConfig(CONFIG);
  send(res, 200, { ok: true });
}

function handleCompressionGet(_req, res) {
  send(res, 200, getOptimization().compression);
}

async function handleCompressionPost(req, res) {
  const body = await readJSONBody(req);
  CONFIG.optimization = CONFIG.optimization || {};
  CONFIG.optimization.compression = { ...getOptimization().compression };
  if (typeof body.enabled === 'boolean') CONFIG.optimization.compression.enabled = body.enabled;
  if (body.mode && typeof body.mode === 'string') CONFIG.optimization.compression.mode = body.mode;
  delete CONFIG.compression; // retire the legacy top-level key
  saveConfig(CONFIG);
  send(res, 200, { ok: true, compression: CONFIG.optimization.compression });
}

// ---- Unified optimization config + live stats ----

function handleOptimizationGet(_req, res) {
  send(res, 200, { optimization: getOptimization(), defaults: DEFAULT_OPTIMIZATION });
}

async function handleOptimizationPost(req, res) {
  const body = await readJSONBody(req);
  const incoming = body.optimization || body;
  const current = getOptimization();
  const next = {};
  // Deep-merge each known section; ignore unknown keys.
  for (const section of Object.keys(DEFAULT_OPTIMIZATION)) {
    next[section] = { ...current[section], ...(incoming[section] || {}) };
  }
  // Coerce numeric/boolean fields defensively.
  next.toolResults.stripBlankLines = next.toolResults.stripBlankLines === true;
  next.toolResults.dedupeLines     = next.toolResults.dedupeLines === true;
  next.toolResults.maxChars       = Math.max(0, Number(next.toolResults.maxChars)       || 0);
  next.historyTrim.maxMessages    = Math.max(2, Number(next.historyTrim.maxMessages)    || 2);
  next.historyTrim.keepFirstN     = Math.max(0, Number(next.historyTrim.keepFirstN)     || 0);
  next.historyTrim.maxInputTokens = Math.max(0, Number(next.historyTrim.maxInputTokens) || 0);
  next.toolCompress.maxDescLength = Math.max(40, Number(next.toolCompress.maxDescLength) || 40);
  next.leanContext.keepFirstN    = Math.max(0, Number(next.leanContext.keepFirstN) || 0);
  next.leanContext.keepLastN     = Math.max(2, Number(next.leanContext.keepLastN) || 24);
  next.leanContext.minChars      = Math.max(200, Number(next.leanContext.minChars) || 1200);
  next.leanContext.summaryChars  = Math.max(120, Number(next.leanContext.summaryChars) || 700);
  next.leanContext.minSavingsTokens = Math.max(0, Number(next.leanContext.minSavingsTokens) || 512);
  next.cacheInject.ttl           = next.cacheInject.ttl === '1h' ? '1h' : '5m';
  next.cacheInject.minTokens     = Math.max(0, Number(next.cacheInject.minTokens) || 256);
  next.responseCache.ttlMinutes   = Math.max(0, Number(next.responseCache.ttlMinutes)   || 0);
  next.responseCache.maxBodyBytes  = Math.max(1024, Number(next.responseCache.maxBodyBytes) || 2_000_000);
  next.responseCache.includeStreaming = next.responseCache.includeStreaming !== false;
  next.responseCache.cacheWebSearch = next.responseCache.cacheWebSearch === true;
  if (next.responseStyle) {
    next.responseStyle.enabled = next.responseStyle.enabled !== false;
    if (!['lite','full','ultra'].includes(next.responseStyle.mode)) next.responseStyle.mode = 'full';
  }
  CONFIG.optimization = next;
  delete CONFIG.compression;
  saveConfig(CONFIG);
  send(res, 200, { ok: true, optimization: getOptimization() });
}

function handleOptimizationStats(_req, res) {
  const uptimeMs = Date.now() - OPT_STATS.startedAt;
  const totalCharsSaved = OPT_STATS.toolResultCharsSaved + OPT_STATS.toolDescCharsSaved + OPT_STATS.leanContextCharsSaved + OPT_STATS.proseCharsSaved;
  const cacheStats = store.cacheStats();
  const derivedCacheHits = Math.max(OPT_STATS.responseCacheHits || 0, cacheStats.hits || 0);
  const derivedCacheTokensSaved = Math.max(OPT_STATS.responseCacheTokensSaved || 0, cacheStats.servedTokens || 0);
  let derivedCacheCostSavedNano = OPT_STATS.responseCacheCostSavedNano || 0;
  if (!derivedCacheCostSavedNano && derivedCacheTokensSaved > 0) {
    const cost = pricingCalc.calculateCostNano(derivedCacheTokensSaved, 0, CONFIG.providers?.[CONFIG.provider]?.model || CONFIG.provider || 'unknown');
    derivedCacheCostSavedNano = cost?.cost_nano_usd || 0;
  }
  // Cost-saved estimate: optimizer-saved tokens at a representative input rate
  // (~$3 / 1M) plus the actual/derived cost avoided by response-cache hits.
  const estCostSavedUsd = (OPT_STATS.estTokensSaved / 1e6) * 3.0 + (derivedCacheCostSavedNano / 1e9) + (OPT_STATS.promptCacheSavingsNano / 1e9);
  const hitRate = (derivedCacheHits + OPT_STATS.responseCacheMisses) > 0
    ? derivedCacheHits / (derivedCacheHits + OPT_STATS.responseCacheMisses)
    : 0;
  send(res, 200, {
    ...OPT_STATS,
    uptimeMs,
    totalCharsSaved,
    estCostSavedUsd: Number(estCostSavedUsd.toFixed(6)),
    storeBackend: store.info().backend,
    storeFile: store.info().dbFile,
    responseCache: {
      hits: derivedCacheHits,
      misses: OPT_STATS.responseCacheMisses,
      stored: Math.max(OPT_STATS.responseCacheStored || 0, cacheStats.entries || 0),
      bypassed: OPT_STATS.responseCacheBypassed,
      bypassReasons: {
        header: OPT_STATS.responseCacheBypassHeader || 0,
        metadata: OPT_STATS.responseCacheBypassMetadata || 0,
        claudeCodeToolStream: OPT_STATS.responseCacheBypassClaudeCodeToolStream || 0,
        streamingDisabled: OPT_STATS.responseCacheBypassStreamingDisabled || 0,
        webSearch: OPT_STATS.responseCacheBypassWebSearch || 0,
        noKey: OPT_STATS.responseCacheBypassNoKey || 0,
      },
      tooLarge: OPT_STATS.responseCacheTooLarge,
      hitRate: Number(hitRate.toFixed(3)),
      entries: cacheStats.entries,
      storeHits: cacheStats.hits,
      cachedTokens: cacheStats.cachedTokens,
      servedTokens: cacheStats.servedTokens,
      storedUnservedTokens: cacheStats.storedUnservedTokens || 0,
      tokensSaved: derivedCacheTokensSaved,
      costSavedNano: derivedCacheCostSavedNano,
      ttlMinutes: getOptimization().responseCache.ttlMinutes,
      ttlLabel: Number(getOptimization().responseCache.ttlMinutes || 0) === 0 ? 'Never expires' : `${getOptimization().responseCache.ttlMinutes} min`,
      enabled: getOptimization().responseCache.enabled,
      includeStreaming: getOptimization().responseCache.includeStreaming,
      cacheWebSearch: getOptimization().responseCache.cacheWebSearch,
      note: 'Exact response replay only. Claude Code turns usually miss because messages/tool results change every turn; prompt-cache reads are tracked separately from usage.cache_read_input_tokens.',
      claudeCodeFastPathBypass: OPT_STATS.claudeCodeFastPathRequests,
    },
    leanContext: {
      turnsCompacted: OPT_STATS.leanContextTurnsCompacted,
      charsSaved: OPT_STATS.leanContextCharsSaved,
      tokensSavedEstimate: Math.round((OPT_STATS.leanContextCharsSaved || 0) / 4),
      enabled: getOptimization().leanContext.enabled,
    },
    promptCache: {
      creationTokens: OPT_STATS.promptCacheCreationTokens,
      readTokens: OPT_STATS.promptCacheReadTokens,
      savingsNano: OPT_STATS.promptCacheSavingsNano,
      writeCostNano: OPT_STATS.promptCacheWriteCostNano,
      breakpointsInjected: OPT_STATS.cacheBreakpointsInjected,
      breakpointsPreserved: OPT_STATS.cacheBreakpointsPreserved,
      breakpointsStripped: OPT_STATS.cacheBreakpointsStripped,
      unsupportedStripped: OPT_STATS.cacheBreakpointsUnsupported,
      ttl: getOptimization().cacheInject.ttl === '1h' ? '1h' : '5m',
      cacheablePrefixTokens: OPT_STATS.cacheCacheablePrefixTokens,
    },
    cache: { ...cacheStats, hitRate: Number(hitRate.toFixed(3)) },
  });
}

function handleCacheClear(_req, res) {
  try {
    store.cacheClear();
    for (const k of Object.keys(OPT_STATS)) {
      if (k.startsWith('responseCache')) OPT_STATS[k] = 0;
    }
    markOptStatsDirty();
    send(res, 200, { ok: true, responseCache: { hits: 0, misses: 0, stored: 0, entries: 0 } });
  }
  catch (e) { send(res, 500, { ok: false, error: e.message }); }
}

async function handleAnalyticsGet(_req, res) {
  try {
    const [sessionStats, lifetimeStats, history] = await Promise.all([
      analytics.getSessionStats(),
      analytics.getLifetimeStats(),
      analytics.getRequestHistory(null, 100)
    ]);
    send(res, 200, { session: sessionStats, lifetime: lifetimeStats, history });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}

async function handleDashboardSummaryData() {
  const [sessionStats, lifetimeStats, requestHistory, poolData] = await Promise.all([
    analytics.getSessionStats(null, pricingCalc),
    analytics.getLifetimeStats(pricingCalc),
    analytics.getRequestHistory(null, 12),
    Promise.resolve(buildPoolSummary())
  ]);
  const cacheStats = store.cacheStats();
  const hitRate = (cacheStats.hits + OPT_STATS.responseCacheMisses) > 0
    ? cacheStats.hits / (cacheStats.hits + OPT_STATS.responseCacheMisses)
    : 0;
  const recentLogs = REQUEST_LOG.slice(-20).reverse();
  const lastError = recentLogs.find(l => l.finalStatus && l.finalStatus !== 'ok' && l.finalStatus !== 'cache-hit') || null;
  return {
    timestamp: new Date().toISOString(),
    active: {
      provider: CONFIG.provider || null,
      model: activeProviderConfig()?.model || null,
      poolMode: Array.isArray(CONFIG.pool) && CONFIG.pool.length > 0,
    },
    session: sessionStats,
    lifetime: lifetimeStats,
    optimization: {
      preset: OPT_STATS.claudeCodeFastPathRequests ? 'claude-code fast-safe' : 'balanced',
      fastPathRequests: OPT_STATS.claudeCodeFastPathRequests || 0,
      requests: OPT_STATS.requests || 0,
      tokensSaved: OPT_STATS.estTokensSaved || 0,
      costSavedUsd: Number(((OPT_STATS.estTokensSaved / 1e6) * 3.0 + (OPT_STATS.responseCacheCostSavedNano / 1e9) + (OPT_STATS.promptCacheSavingsNano / 1e9)).toFixed(6)),
    },
    cache: {
      entries: cacheStats.entries,
      hits: Math.max(cacheStats.hits || 0, OPT_STATS.responseCacheHits || 0),
      misses: OPT_STATS.responseCacheMisses || 0,
      hitRate: Number(hitRate.toFixed(3)),
      tokensSaved: Math.max(cacheStats.servedTokens || 0, OPT_STATS.responseCacheTokensSaved || 0),
      storedUnservedTokens: cacheStats.storedUnservedTokens || 0,
      ttlLabel: Number(getOptimization().responseCache.ttlMinutes || 0) === 0 ? 'Never expires' : `${getOptimization().responseCache.ttlMinutes} min`,
      promptReadTokens: OPT_STATS.promptCacheReadTokens || 0,
      promptCreationTokens: OPT_STATS.promptCacheCreationTokens || 0,
    },
    claudeCode: {
      status: lastError ? 'watch' : 'ready',
      fastPathRequests: OPT_STATS.claudeCodeFastPathRequests || 0,
      lastStopReason: recentLogs[0]?.notes?.stopReason || recentLogs[0]?.attempts?.at(-1)?.stopReason || null,
      lastError: lastError ? {
        id: lastError.id,
        status: lastError.finalStatus,
        error: lastError.error || lastError.attempts?.find(a => a.error)?.error || null,
        time: lastError.ts ? new Date(lastError.ts).toISOString() : null,
      } : null,
    },
    latency: {
      latestMs: recentLogs[0]?.totalMs || 0,
      p50Ms: percentile(recentLogs.map(l => l.totalMs).filter(Boolean), 0.50),
      p95Ms: percentile(recentLogs.map(l => l.totalMs).filter(Boolean), 0.95),
    },
    fanout: {
      inFlight: currentInFlight(),
      capacity: getPool().length * FANOUT.perMember,
      perMember: FANOUT.perMember,
      queueMs: FANOUT.queueMs,
      queuedTotal: OPT_STATS.fanoutQueued || 0,
      queueTimeouts: OPT_STATS.fanoutQueueTimeouts || 0,
      maxConcurrent: OPT_STATS.fanoutMaxConcurrent || 0,
      members: poolRuntimeSnapshot(),
    },
    toolRepair: {
      skipped: OPT_STATS.toolCallsSkipped || 0,
      repaired: OPT_STATS.toolCallsRepaired || 0,
    },
    pool: poolData,
    recent: requestHistory,
    recentLogs: recentLogs.slice(0, 8),
    store: store.info(),
  };
}

async function handleDashboardSummary(_req, res) {
  try { send(res, 200, await handleDashboardSummaryData()); }
  catch (err) { send(res, 500, { error: err.message }); }
}

function percentile(values, p) {
  const nums = values.filter(n => Number.isFinite(Number(n))).map(Number).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const idx = Math.min(nums.length - 1, Math.max(0, Math.ceil(nums.length * p) - 1));
  return nums[idx];
}

function buildPoolSummary() {
  const now = Date.now();
  const entries = (CONFIG.pool && CONFIG.pool.length ? CONFIG.pool : (CONFIG.provider ? [{ provider: CONFIG.provider, ...(CONFIG.providers?.[CONFIG.provider] || {}) }] : []));
  return entries.map(e => {
    const stat = poolStats.get(e._key) || poolStats.get(`${e.provider}::${e.model}`) || { req: 0, err: 0, lastMs: 0, cooledUntil: 0 };
    return {
      provider: e.provider,
      model: e.model,
      label: e.label || `${e.provider} / ${e.model || 'model'}`,
      category: e.category || inferModelProfile(e.model, e.provider).category,
      tags: e.tags || inferModelProfile(e.model, e.provider).tags,
      priority: e.priority ?? inferModelProfile(e.model, e.provider).priority,
      requests: stat.req || 0,
      errors: stat.err || 0,
      lastMs: stat.lastMs || 0,
      errorRate: stat.req ? Number(((stat.err || 0) / stat.req).toFixed(3)) : 0,
      cooldownSecsLeft: stat.cooledUntil > now ? Math.ceil((stat.cooledUntil - now) / 1000) : 0,
    };
  });
}

function handleLimitsGet(_req, res) {
  const now = Date.now();
  limiter.prune(now);
  send(res, 200, {
    limits: getLimits(),
    usage: { rpm: limiter.reqs.length, tpm: limiter.tokenSum(), windowSeconds: 60, spendUsd: spendTracker.total(now), spendWindowHours: 24 }
  });
}

async function handleLimitsPost(req, res) {
  const body = await readJSONBody(req);
  const next = { ...DEFAULT_LIMITS, ...(CONFIG.limits || {}) };
  if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
  if (body.rpm != null) {
    const n = Number(body.rpm);
    if (!Number.isFinite(n) || n < 0) return send(res, 400, { error: 'rpm must be a non-negative number' });
    next.rpm = Math.floor(n);
  }
  if (body.tpm != null) {
    const n = Number(body.tpm);
    if (!Number.isFinite(n) || n < 0) return send(res, 400, { error: 'tpm must be a non-negative number' });
    next.tpm = Math.floor(n);
  }
  if (body.dailyCapUsd != null) {
    const n = Number(body.dailyCapUsd);
    if (!Number.isFinite(n) || n < 0) return send(res, 400, { error: 'dailyCapUsd must be a non-negative number' });
    next.dailyCapUsd = n;
  }
  CONFIG.limits = next;
  saveConfig(CONFIG);
  send(res, 200, { ok: true, limits: getLimits() });
}

async function handleTest(req, res) {
  const body = await readJSONBody(req);
  const provider = body.provider;
  const cfg = { kind: provider, ...(body.config || {}) };
  // Resolve masked secrets from saved config.
  const saved = (CONFIG.providers || {})[provider] || {};
  if (typeof cfg.apiKey === 'string' && cfg.apiKey.startsWith('••••')) cfg.apiKey = saved.apiKey;
  if (typeof cfg.secretAccessKey === 'string' && cfg.secretAccessKey.startsWith('••••')) cfg.secretAccessKey = saved.secretAccessKey;
  // Fail fast on the Test button so the UI never hangs.
  cfg.timeoutMs = 20000;

  const probe = {
    model: cfg.model,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    stream: false
  };
  // Capture upstream response in-memory.
  const fakeRes = new MemoryResponse();
  try {
    if (provider === 'bedrock') await callBedrock(cfg, probe, fakeRes);
    else await callOpenAICompatible(cfg, probe, fakeRes);
    const txt = fakeRes.bodyString();
    send(res, 200, { ok: true, sample: txt.slice(0, 400) });
  } catch (err) {
    send(res, 200, { ok: false, error: String(err.message || err) });
  }
}

class MemoryResponse {
  constructor() { this.headers = {}; this.chunks = []; this.headersSent = false; }
  setHeader(k, v) { this.headers[k] = v; }
  writeHead(s, h) { this.status = s; Object.assign(this.headers, h || {}); this.headersSent = true; }
  write(chunk) { this.chunks.push(Buffer.from(chunk)); }
  end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); }
  bodyString() { return Buffer.concat(this.chunks).toString('utf8'); }
}

// ---- System inspection ----

function probeVersion(bin, arg = '--version') {
  try {
    const r = spawnSync(bin, [arg], { encoding: 'utf8', timeout: 4000 });
    if (r.status === 0) return (r.stdout || r.stderr || '').trim().split('\n')[0];
  } catch {}
  return null;
}

function isAdminSync() {
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('net', ['session'], { encoding: 'utf8', timeout: 3000 });
      return r.status === 0;
    } catch { return false; }
  }
  try { return process.getuid() === 0 || spawnSync('sudo', ['-n', 'true']).status === 0; }
  catch { return false; }
}

function buildSystem() {
  const node = { path: process.execPath, version: process.version, ok: true };

  const npmPath = installer.which('npm');
  const npmVer = npmPath ? probeVersion(npmPath) : null;
  const npm = { path: npmPath, version: npmVer, ok: !!npmPath };

  const claudePath = installer.detectClaude(npmPath);
  const claudeVer = claudePath ? probeVersion(claudePath) : null;
  const claude = { path: claudePath, version: claudeVer, ok: !!claudePath };

  const pythonPath = installer.detectPython ? installer.detectPython() : null;
  const pythonVer = pythonPath ? probeVersion(pythonPath) : null;
  const python = { path: pythonPath, version: pythonVer, ok: !!pythonPath };

  const admin = isAdminSync();

  const home = os.homedir();
  const writableHome = (() => {
    try { fs.accessSync(home, fs.constants.W_OK); return true; } catch { return false; }
  })();

  // Useful path candidates we scanned for binaries.
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);

  return {
    platform: process.platform,
    arch: process.arch,
    user: os.userInfo().username,
    home,
    writableHome,
    admin,
    proxyHome: installer.ROOT,
    npmPrefix: installer.NPM_PREFIX,
    portableNodeDir: installer.NODE_DIR,
    pathDirs,
    components: { node, npm, claude, python },
    canConfigure: !!claudePath
  };
}

async function handleSystem(_req, res) {
  send(res, 200, buildSystem());
}

// Spawn an installer step and stream stdout/stderr back as plain text.
async function handleInstall(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const what = u.searchParams.get('what') || 'all'; // 'node' | 'claude' | 'all'
  const wantAdmin = u.searchParams.get('admin') === '1';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  const send = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  send({ type: 'log', msg: `Starting install (target=${what}, useAdmin=${wantAdmin})` });

  const args = ['src/install.js'];
  if (what === 'node')   args.push('--node-only');
  if (what === 'claude') args.push('--claude-only');
  const env = { ...process.env };
  if (!wantAdmin) env.PROXY_MAX_NO_ADMIN = '1'; // hint (the installer also auto-detects)

  const child = spawn(process.execPath, args, { cwd: ROOT, env });
  child.stdout.on('data', d => send({ type: 'log', msg: d.toString() }));
  child.stderr.on('data', d => send({ type: 'log', msg: d.toString(), level: 'warn' }));
  // Without this handler, a spawn failure (e.g. ENOENT/EINVAL) emits an
  // unhandled 'error' event, which Node throws and crashes the whole server.
  child.on('error', err => {
    send({ type: 'log', msg: `Failed to start installer: ${err.message}`, level: 'error' });
    send({ type: 'done', code: 1, system: buildSystem() });
    res.end();
  });
  child.on('close', code => {
    send({ type: 'done', code, system: buildSystem() });
    res.end();
  });
}

let SELF_UPDATE_IN_PROGRESS = false;

function runStepStreaming(send, command, args, opts = {}) {
  return new Promise(resolve => {
    function attempt(useShell) {
      let child;
      try {
        child = spawn(command, args, {
          cwd: ROOT,
          env: { ...process.env, ...(opts.env || {}) },
          shell: useShell
        });
      } catch (err) {
        // spawn can throw EINVAL/ENOENT synchronously (before the 'error' event)
        // depending on how the parent process was launched. Mirror the async
        // handler: retry once through the shell when allowed, else resolve.
        if (!useShell && opts.shellFallback && (err.code === 'EINVAL' || err.code === 'ENOENT')) {
          send({ type: 'log', msg: `[update] ${command} threw ${err.code} on spawn, retrying via shell...`, level: 'warn' });
          attempt(true);
          return;
        }
        send({ type: 'log', msg: `[update] failed to start ${command}: ${err.message}`, level: 'warn' });
        resolve({ code: 1, signal: null });
        return;
      }
      child.stdout.on('data', d => send({ type: 'log', msg: d.toString() }));
      child.stderr.on('data', d => send({ type: 'log', msg: d.toString(), level: 'warn' }));
      child.on('error', err => {
        // Resolved binary paths (e.g. npm, which is often a multi-hop symlink
        // ending in a `#!/usr/bin/env node` script) can occasionally fail to
        // spawn directly with EINVAL/ENOENT depending on how the parent
        // process itself was launched. Retrying once through the shell lets
        // /bin/sh perform its own exec/shebang resolution instead of Node's.
        // Only enabled at call sites with hardcoded, trusted arguments.
        if (!useShell && opts.shellFallback && (err.code === 'EINVAL' || err.code === 'ENOENT')) {
          send({ type: 'log', msg: `[update] ${command} failed to spawn directly (${err.code}), retrying via shell...`, level: 'warn' });
          attempt(true);
          return;
        }
        send({ type: 'log', msg: `[update] failed to start ${command}: ${err.message}`, level: 'warn' });
        resolve({ code: 1, signal: null });
      });
      child.on('close', (code, signal) => resolve({ code: code ?? 1, signal: signal || null }));
    }
    attempt(false);
  });
}

function runCapture(command, args, timeoutMs = 4000) {
  try {
    const r = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs });
    if (r.status === 0) return (r.stdout || '').trim();
  } catch {}
  return null;
}

function parseGithubRepo(repoUrl = '') {
  const raw = String(repoUrl || '').trim();
  if (!raw) return null;
  let m = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = raw.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

function getUpdateArchiveCandidates() {
  const candidates = [];
  const explicit = CONFIG?.update?.archiveUrl || process.env.PROXY_MAX_UPDATE_URL;
  if (explicit) candidates.push(explicit);

  let pkgRepo = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    pkgRepo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  } catch {}

  const gh = parseGithubRepo(pkgRepo || runCapture('git', ['config', '--get', 'remote.origin.url']) || '');
  if (gh) {
    const ref = String(CONFIG?.update?.ref || process.env.PROXY_MAX_UPDATE_REF || 'main').trim() || 'main';
    // Primary: configured ref. Then common fallback refs for repos not using main.
    candidates.push(`https://codeload.github.com/${gh.owner}/${gh.repo}/tar.gz/refs/heads/${ref}`);
    if (ref !== 'main') candidates.push(`https://codeload.github.com/${gh.owner}/${gh.repo}/tar.gz/refs/heads/main`);
    if (ref !== 'master') candidates.push(`https://codeload.github.com/${gh.owner}/${gh.repo}/tar.gz/refs/heads/master`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function shouldPreserveLocalEntry(name) {
  const n = String(name || '');
  if (!n) return false;
  if (n === 'config.json' || n === 'logs' || n === 'node_modules' || n === '.git') return true;
  if (n === '.update-backup') return true;
  if (n === '.env' || n === '.env.local') return true;
  return n.startsWith('.env.');
}

function copyTreeSync(srcDir, dstDir) {
  const stat = fs.lstatSync(srcDir);
  if (stat.isDirectory()) {
    fs.mkdirSync(dstDir, { recursive: true });
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      copyTreeSync(path.join(srcDir, ent.name), path.join(dstDir, ent.name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dstDir), { recursive: true });
  fs.copyFileSync(srcDir, dstDir);
}

function replaceProjectFromExtract(extractedRoot) {
  const currentEntries = fs.readdirSync(ROOT, { withFileTypes: true });
  for (const ent of currentEntries) {
    if (shouldPreserveLocalEntry(ent.name)) continue;
    fs.rmSync(path.join(ROOT, ent.name), { recursive: true, force: true });
  }

  const newEntries = fs.readdirSync(extractedRoot, { withFileTypes: true });
  for (const ent of newEntries) {
    if (shouldPreserveLocalEntry(ent.name)) continue;
    copyTreeSync(path.join(extractedRoot, ent.name), path.join(ROOT, ent.name));
  }
}

async function downloadArchiveToFile(url, filePath) {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'proxy-max-updater',
      'accept': 'application/gzip, application/x-gzip, application/octet-stream, */*'
    }
  });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(filePath, buf);
  return buf.length;
}

// Pure Node.js tar.gz extractor — no external `tar` binary required, so the
// archive-update path works identically on Windows/macOS/Linux with nothing
// installed beyond Node itself. Handles ustar + GNU long-name + PAX path
// overrides (what GitHub's codeload archives use) and guards against zip-slip
// path traversal.
function parseTarOctal(buf) {
  const s = buf.toString('ascii').replace(/\0/g, '').trim();
  if (!s) return 0;
  // PAX/GNU base-256 encoding starts with 0x80 in the first byte; we only need
  // decimal-range sizes for source archives, so plain octal covers all cases.
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

function extractTarGzPureJs(archiveFile, destDir) {
  const zlib = require('zlib');
  const gzipped = fs.readFileSync(archiveFile);
  const buffer = zlib.gunzipSync(gzipped);

  let offset = 0;
  let longName = null;
  let paxPath = null;
  const destResolved = path.resolve(destDir);

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) { offset += 512; continue; }

    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseTarOctal(header.subarray(124, 136));
    const typeFlag = String.fromCharCode(header[156] || 0);
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');

    offset += 512;
    const dataStart = offset;
    const dataEnd = dataStart + size;
    const paddedBlocks = Math.ceil(size / 512) * 512;

    if (typeFlag === 'x' || typeFlag === 'g') {
      // PAX extended header record(s): "<len> <key>=<value>\n"
      const data = buffer.subarray(dataStart, dataEnd).toString('utf8');
      let idx = 0;
      while (idx < data.length) {
        const spaceIdx = data.indexOf(' ', idx);
        if (spaceIdx === -1) break;
        const len = parseInt(data.slice(idx, spaceIdx), 10);
        if (!len || len <= 0) break;
        const record = data.slice(idx, idx + len);
        const eqIdx = record.indexOf('=');
        if (eqIdx !== -1) {
          const key = record.slice(spaceIdx - idx + 1, eqIdx);
          const value = record.slice(eqIdx + 1, len - 1);
          if (key === 'path') paxPath = value;
        }
        idx += len;
      }
      offset += paddedBlocks;
      continue;
    }
    if (typeFlag === 'L') {
      // GNU long-name extension: data block holds the real entry name.
      longName = buffer.subarray(dataStart, dataEnd).toString('utf8').replace(/\0+$/, '');
      offset += paddedBlocks;
      continue;
    }

    const entryName = paxPath || longName || (prefix ? `${prefix}/${rawName}` : rawName);
    longName = null;
    paxPath = null;

    if (entryName) {
      const targetPath = path.resolve(destDir, entryName);
      if (!targetPath.startsWith(destResolved + path.sep) && targetPath !== destResolved) {
        throw new Error(`Refusing to extract entry outside target directory: ${entryName}`);
      }
      if (typeFlag === '5') {
        fs.mkdirSync(targetPath, { recursive: true });
      } else if (typeFlag === '0' || typeFlag === '' || typeFlag === '\0') {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, buffer.subarray(dataStart, dataEnd));
      }
      // Symlinks and other special types are skipped intentionally for safety.
    }
    offset += paddedBlocks;
  }
}

async function extractUpdateArchive(stream, archiveFile, tmpBase) {
  const tarPath = installer.which('tar');
  if (tarPath && runCapture(tarPath, ['--version'])) {
    stream({ type: 'log', msg: '[update] Extracting via system tar...' });
    const extractStep = await runStepStreaming(stream, tarPath, ['-xzf', archiveFile, '-C', tmpBase], { shellFallback: true });
    if (extractStep.code === 0) return;
    stream({ type: 'log', msg: '[update] system tar failed, falling back to built-in extractor...', level: 'warn' });
  } else {
    stream({ type: 'log', msg: '[update] No system tar found — using built-in Node.js extractor...' });
  }
  extractTarGzPureJs(archiveFile, tmpBase);
}

async function updateFromArchive(stream) {
  const candidates = getUpdateArchiveCandidates();
  if (!candidates.length) {
    throw new Error('No update source configured. Set update.archiveUrl in config.json or package repository URL.');
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-max-update-'));
  const archiveFile = path.join(tmpBase, 'update.tar.gz');

  let selectedUrl = null;
  let downloadBytes = 0;
  let lastErr = null;
  for (const url of candidates) {
    stream({ type: 'log', msg: `[update] Downloading package: ${url}` });
    try {
      downloadBytes = await downloadArchiveToFile(url, archiveFile);
      selectedUrl = url;
      break;
    } catch (err) {
      lastErr = err;
      stream({ type: 'log', msg: `[update] download failed for ${url}: ${err.message}`, level: 'warn' });
    }
  }
  if (!selectedUrl) throw lastErr || new Error('Could not download update package');

  stream({ type: 'log', msg: `[update] Downloaded ${Math.round(downloadBytes / 1024)} KB` });
  await extractUpdateArchive(stream, archiveFile, tmpBase);

  const extracted = fs.readdirSync(tmpBase, { withFileTypes: true }).find(d => d.isDirectory() && !d.name.startsWith('.'));
  if (!extracted) throw new Error('Update archive did not contain a project directory');
  const extractedRoot = path.join(tmpBase, extracted.name);

  stream({ type: 'log', msg: '[update] Replacing application files (preserving config/logs/env/node_modules)...' });
  replaceProjectFromExtract(extractedRoot);

  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  return { source: selectedUrl, changed: true };
}

function scheduleSelfRestart() {
  const serverScript = path.join(ROOT, 'src', 'server.js');
  // `detached: true` on macOS/libuv calls posix_spawn() with POSIX_SPAWN_SETSID,
  // which is known to fail with EINVAL on some macOS/libuv combinations depending
  // on how the parent process itself was started. Guard the inner spawn against
  // that: if the detached attempt errors, retry without `detached` (still safe
  // to outlive the parent thanks to stdio:"ignore" + unref()).
  const launcherScript = [
    'const { spawn } = require("child_process");',
    `const nodeBin = ${JSON.stringify(process.execPath)};`,
    `const serverScript = ${JSON.stringify(serverScript)};`,
    `const cwd = ${JSON.stringify(ROOT)};`,
    'function startServer(detached) {',
    '  let child;',
    '  try {',
    '    child = spawn(nodeBin, [serverScript], {',
    '      cwd,',
    '      detached,',
    '      stdio: "ignore",',
    '      env: process.env',
    '    });',
    '  } catch (err) {',
    '    if (detached && err && err.code === "EINVAL") { startServer(false); return; }',
    '    console.error("[update] failed to restart server (sync):", err && err.message);',
    '    return;',
    '  }',
    '  child.on("error", err => {',
    '    if (detached && err && err.code === "EINVAL") { startServer(false); return; }',
    '    console.error("[update] failed to restart server:", err && err.message);',
    '  });',
    '  if (detached) child.unref();',
    '}',
    'setTimeout(() => startServer(true), 1200);',
  ].join(' ');

  // Build a spawn-safe env. Node's spawn rejects env values that are not strings
  // (undefined/null members trigger EINVAL on some platforms). HOST in particular
  // may be undefined here, which was one cause of the "spawn EINVAL" failures.
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null) env[k] = String(v);
  }
  env.PORT = String(PORT);
  if (HOST != null && HOST !== '') env.HOST = String(HOST);
  function spawnLauncher(detached) {
    let launcher;
    try {
      launcher = spawn(process.execPath, ['-e', launcherScript], {
        cwd: ROOT,
        detached,
        stdio: 'ignore',
        env,
      });
    } catch (err) {
      // spawn can throw EINVAL synchronously (before any 'error' event) on some
      // macOS/libuv combinations when detached. Fall back to a non-detached spawn.
      if (detached && err && err.code === 'EINVAL') { spawnLauncher(false); return; }
      console.error('[update] failed to schedule self-restart (sync):', err && err.message, '| code:', err && err.code);
      return;
    }
    // Same EINVAL guard as the inner spawn above — without this handler a
    // spawn failure here would throw an unhandled 'error' event and crash
    // the proxy process right as the update finishes.
    launcher.on('error', err => {
      if (detached && err && err.code === 'EINVAL') { spawnLauncher(false); return; }
      console.error('[update] failed to schedule self-restart:', err && err.message, '| code:', err && err.code);
    });
    if (detached) launcher.unref();
  }
  spawnLauncher(true);
}

// Installs project dependencies with layered auto-recovery, since this runs
// unattended right after an update and has no human around to fix problems:
//   - auto-resolve: re-locate npm (incl. auto-installing a portable Node/npm
//     via installer.ensureNode() if none can be found at all)
//   - auto-fix: repair a missing executable bit on the resolved npm binary
//   - auto-delete path: wipe a possibly-corrupted node_modules and retry
//     clean (falling back from `npm ci` to `npm install` if the lockfile
//     itself is the problem)
async function installDependencies(stream) {
  const lockfilePath = path.join(ROOT, 'package-lock.json');
  const nodeModulesPath = path.join(ROOT, 'node_modules');

  async function resolveNpm() {
    let npmPath = installer.which('npm');
    if (!npmPath) {
      stream({ type: 'log', msg: '[update] npm not found, auto-installing a portable Node/npm...', level: 'warn' });
      try {
        const ensured = await installer.ensureNode();
        npmPath = ensured && ensured.npm;
      } catch (err) {
        stream({ type: 'log', msg: `[update] auto-install of portable Node failed: ${err.message}`, level: 'warn' });
      }
    }
    return npmPath || 'npm';
  }

  function autoFixPermissions(npmPath) {
    try {
      if (fs.existsSync(npmPath)) {
        const st = fs.statSync(npmPath);
        if (st.isFile() && (st.mode & 0o111) === 0) {
          stream({ type: 'log', msg: '[update] npm binary missing executable bit, auto-fixing permissions...', level: 'warn' });
          fs.chmodSync(npmPath, st.mode | 0o111);
        }
      }
    } catch {}
  }

  function npmArgsFor() {
    const hasLockfile = fs.existsSync(lockfilePath);
    return hasLockfile ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'];
  }

  let npmPath = await resolveNpm();
  autoFixPermissions(npmPath);

  let npmArgs = npmArgsFor();
  stream({ type: 'log', msg: `[update] Installing dependencies (npm ${npmArgs.join(' ')})...` });
  let npmStep = await runStepStreaming(stream, npmPath, npmArgs, { shellFallback: true });

  if (npmStep.code !== 0) {
    stream({ type: 'log', msg: '[update] Dependency install failed, auto-deleting node_modules and retrying a clean install...', level: 'warn' });
    try { fs.rmSync(nodeModulesPath, { recursive: true, force: true }); } catch {}

    // A stale/mismatched lockfile can make `npm ci` fail even on a clean
    // node_modules — fall back to `npm install` on retry so it can self-heal.
    if (npmArgs[0] === 'ci') npmArgs = ['install', '--no-audit', '--no-fund'];

    // Re-resolve in case the first attempt picked a broken/unspawnable path.
    npmPath = await resolveNpm();
    autoFixPermissions(npmPath);

    stream({ type: 'log', msg: `[update] Retrying (npm ${npmArgs.join(' ')})...` });
    npmStep = await runStepStreaming(stream, npmPath, npmArgs, { shellFallback: true });
  }

  npmStep.attemptedArgs = npmArgs;
  return npmStep;
}

// --- Update safety: backup, rollback, validation ---------------------------

const UPDATE_BACKUP_DIR = '.update-backup';

// Entries never copied into a backup: huge, VCS-managed, regenerated, or the
// backup store itself. Everything else (src, package.json, ui, tests, config)
// is snapshotted so a failed update can be fully reverted.
function isBackupExcluded(name) {
  const n = String(name || '');
  return n === 'node_modules' || n === '.git' || n === 'logs' || n === UPDATE_BACKUP_DIR;
}

// Snapshot the current application tree into ROOT/.update-backup/<ts> before any
// files are mutated. Keeps only the two most recent backups. Best-effort: on any
// failure it logs and returns null (update proceeds without a restore point).
function createUpdateBackup(stream) {
  try {
    const backupsRoot = path.join(ROOT, UPDATE_BACKUP_DIR);
    fs.mkdirSync(backupsRoot, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(backupsRoot, ts);
    fs.mkdirSync(dir, { recursive: true });
    for (const ent of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (isBackupExcluded(ent.name)) continue;
      copyTreeSync(path.join(ROOT, ent.name), path.join(dir, ent.name));
    }
    // Prune to the last 2 backups (sorted lexicographically == chronologically).
    const all = fs.readdirSync(backupsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name).sort();
    while (all.length > 2) {
      const old = all.shift();
      try { fs.rmSync(path.join(backupsRoot, old), { recursive: true, force: true }); } catch {}
    }
    stream && stream({ type: 'log', msg: `[update] Backup created: ${UPDATE_BACKUP_DIR}/${ts}` });
    return dir;
  } catch (err) {
    stream && stream({ type: 'log', msg: `[update] Backup failed (continuing without restore point): ${err.message}`, level: 'warn' });
    return null;
  }
}

// Restore a backup tree over ROOT, respecting preserved local entries. Used when
// post-update validation fails so the running install is left exactly as it was.
function restoreUpdateBackup(backupDir, stream) {
  if (!backupDir || !fs.existsSync(backupDir)) return false;
  try {
    for (const ent of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (shouldPreserveLocalEntry(ent.name)) continue;
      fs.rmSync(path.join(ROOT, ent.name), { recursive: true, force: true });
    }
    for (const ent of fs.readdirSync(backupDir, { withFileTypes: true })) {
      if (shouldPreserveLocalEntry(ent.name)) continue;
      copyTreeSync(path.join(backupDir, ent.name), path.join(ROOT, ent.name));
    }
    stream && stream({ type: 'log', msg: '[update] Rolled back to pre-update backup.' });
    return true;
  } catch (err) {
    stream && stream({ type: 'log', msg: `[update] Rollback failed: ${err.message}`, level: 'error' });
    return false;
  }
}

// Post-update, pre-restart gate. Syntax-checks every src/**/*.js (plus the entry
// point) with `node --check`, then runs a lightweight smoke test that does not
// bind a port. Returns { ok, error }. Any failure aborts the restart.
async function validateUpdate(stream) {
  const files = [];
  const srcDir = path.join(ROOT, 'src');
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        walk(path.join(dir, ent.name));
      } else if (ent.name.endsWith('.js')) {
        files.push(path.join(dir, ent.name));
      }
    }
  })(srcDir);

  if (!files.length) return { ok: false, error: 'no source files found after update (aborting)' };

  stream({ type: 'log', msg: `[update] Validating ${files.length} source files (node --check)...` });
  for (const f of files) {
    const r = await runStepStreaming(stream, process.execPath, ['--check', f]);
    if (r.code !== 0) return { ok: false, error: `syntax check failed: ${path.relative(ROOT, f)}` };
  }

  const smokeFile = path.join(ROOT, 'test-compat.js');
  if (fs.existsSync(smokeFile)) {
    stream({ type: 'log', msg: '[update] Running smoke test (test-compat.js)...' });
    const r = await runStepStreaming(stream, process.execPath, [smokeFile]);
    if (r.code !== 0) return { ok: false, error: 'smoke test failed (test-compat.js)' };
  }

  stream({ type: 'log', msg: '[update] Validation passed.' });
  return { ok: true };
}

// Read the local package version (best-effort).
function readLocalVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch { return null; }
}

// GET /api/update/check — report whether a newer version is available, without
// mutating anything. Git installs compare local HEAD against the fetched remote
// tip (behind count). Package installs compare the local commit-ish against the
// GitHub API's latest commit for the configured branch. Network-tolerant: any
// failure yields { ok:false } rather than throwing.
async function handleUpdateCheck(req, res) {
  const result = { ok: false, mode: null, currentVersion: readLocalVersion(), updateAvailable: false };
  try {
    const insideGit = runCapture('git', ['rev-parse', '--is-inside-work-tree']);
    if (insideGit === 'true') {
      result.mode = 'git';
      const branch = runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
      const localHead = runCapture('git', ['rev-parse', '--short', 'HEAD']);
      result.current = localHead;
      // ls-remote avoids mutating the local repo (no fetch/reset).
      const remoteUrl = runCapture('git', ['config', '--get', 'remote.origin.url']) || 'origin';
      const remoteLine = runCapture('git', ['ls-remote', remoteUrl, `refs/heads/${branch}`], 8000);
      const remoteSha = remoteLine ? remoteLine.split(/\s+/)[0] : null;
      if (remoteSha) {
        result.remote = remoteSha.slice(0, 7);
        const localFull = runCapture('git', ['rev-parse', 'HEAD']);
        result.updateAvailable = !!localFull && localFull !== remoteSha;
        // Best-effort behind count using merge-base (only works if remote sha is
        // present locally; otherwise a differing sha implies an update exists).
        result.ok = true;
      } else {
        result.ok = false;
      }
      return send(res, 200, result);
    }

    // Archive/package mode: query GitHub for the latest commit on the branch.
    result.mode = 'archive';
    let pkgRepo = null;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      pkgRepo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    } catch {}
    const gh = parseGithubRepo(pkgRepo || runCapture('git', ['config', '--get', 'remote.origin.url']) || '');
    if (!gh) { result.error = 'no github repository configured'; return send(res, 200, result); }
    const ref = String(CONFIG?.update?.ref || process.env.PROXY_MAX_UPDATE_REF || 'main').trim() || 'main';
    const localSha = runCapture('git', ['rev-parse', 'HEAD']) || CONFIG?.update?.installedSha || null;
    const apiUrl = `https://api.github.com/repos/${gh.owner}/${gh.repo}/commits/${encodeURIComponent(ref)}`;
    try {
      const r = await fetch(apiUrl, { headers: { 'user-agent': 'proxy-max-updater', 'accept': 'application/vnd.github+json' } });
      if (r.ok) {
        const body = await r.json();
        const remoteSha = body && body.sha ? String(body.sha) : null;
        if (remoteSha) {
          result.remote = remoteSha.slice(0, 7);
          result.ok = true;
          // If we know a local sha, compare; otherwise report availability unknown-but-checkable.
          result.updateAvailable = localSha ? localSha !== remoteSha : true;
        }
      } else {
        result.error = `github api ${r.status}`;
      }
    } catch (err) {
      result.error = `network: ${err.message}`;
    }
    return send(res, 200, result);
  } catch (err) {
    result.error = String(err.message || err);
    return send(res, 200, result);
  }
}

async function handleSelfUpdate(req, res) {
  if (SELF_UPDATE_IN_PROGRESS) {
    return send(res, 409, { error: 'Update already in progress' });
  }
  SELF_UPDATE_IN_PROGRESS = true;

  const u = new URL(req.url, 'http://localhost');
  const restart = u.searchParams.get('restart') !== '0';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const stream = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  const finish = (payload) => {
    stream({ type: 'done', ...payload });
    res.end();
    SELF_UPDATE_IN_PROGRESS = false;
  };

  try {
    stream({ type: 'log', msg: '[update] Checking installation mode...' });
    const insideGit = runCapture('git', ['rev-parse', '--is-inside-work-tree']);
    let before = null;
    let after = null;
    let changed = false;
    let mode = 'archive';
    let source = null;

    // Snapshot the current install before mutating anything so a failed update
    // (bad syntax, broken smoke test, npm failure) can be fully reverted.
    const backupDir = createUpdateBackup(stream);
    const rollback = async () => {
      if (mode === 'git' && before) {
        stream({ type: 'log', msg: `[update] Rolling back git worktree to ${before}...`, level: 'warn' });
        const r = await runStepStreaming(stream, 'git', ['reset', '--hard', before], { shellFallback: true });
        await runStepStreaming(stream, 'git', ['clean', '-fd'], { shellFallback: true });
        if (r.code === 0) return true;
        stream({ type: 'log', msg: '[update] git rollback failed, trying file backup...', level: 'warn' });
      }
      return restoreUpdateBackup(backupDir, stream);
    };

    if (insideGit === 'true') {
      mode = 'git';
      const branch = runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
      before = runCapture('git', ['rev-parse', '--short', 'HEAD']) || null;
      const remote = runCapture('git', ['config', '--get', 'remote.origin.url']) || 'origin';
      stream({ type: 'log', msg: `[update] Mode: git worktree` });
      stream({ type: 'log', msg: `[update] Branch: ${branch}` });
      stream({ type: 'log', msg: `[update] Remote: ${remote}` });

      const fetchStep = await runStepStreaming(stream, 'git', ['fetch', '--all', '--tags', '--prune'], { shellFallback: true });
      if (fetchStep.code !== 0) {
        return finish({ ok: false, error: 'git fetch failed', code: fetchStep.code });
      }

      const upstream = runCapture('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
      const originHead = runCapture('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
      const targetRef = upstream || originHead || `origin/${branch}`;

      stream({ type: 'log', msg: `[update] Hard-syncing worktree to ${targetRef}...` });
      const resetStep = await runStepStreaming(stream, 'git', ['reset', '--hard', targetRef], { shellFallback: true });
      if (resetStep.code !== 0) {
        return finish({ ok: false, error: `git reset --hard ${targetRef} failed`, code: resetStep.code });
      }

      stream({ type: 'log', msg: '[update] Removing stale untracked files (git clean -fd)...' });
      const cleanStep = await runStepStreaming(stream, 'git', ['clean', '-fd'], { shellFallback: true });
      if (cleanStep.code !== 0) {
        return finish({ ok: false, error: 'git clean -fd failed', code: cleanStep.code });
      }

      if (fs.existsSync(path.join(ROOT, '.gitmodules'))) {
        stream({ type: 'log', msg: '[update] Syncing submodules...' });
        const subStep = await runStepStreaming(stream, 'git', ['submodule', 'update', '--init', '--recursive'], { shellFallback: true });
        if (subStep.code !== 0) {
          return finish({ ok: false, error: 'git submodule update failed', code: subStep.code });
        }
      }

      after = runCapture('git', ['rev-parse', '--short', 'HEAD']) || null;
      changed = !!before && !!after && before !== after;
      source = remote;
      stream({ type: 'log', msg: changed ? `[update] Updated commit ${before} -> ${after}` : `[update] Already up to date (${after || before || 'unknown'})` });
    } else {
      stream({ type: 'log', msg: '[update] Mode: package install (no .git). Using archive update...' });
      const archiveResult = await updateFromArchive(stream);
      changed = !!archiveResult.changed;
      source = archiveResult.source || null;
      stream({ type: 'log', msg: '[update] Package files replaced from archive.' });
    }

    const npmStep = await installDependencies(stream);
    if (npmStep.code !== 0) {
      stream({ type: 'log', msg: '[update] Dependency install failed — rolling back...', level: 'error' });
      const rolledBack = await rollback();
      return finish({ ok: false, error: `npm ${npmStep.attemptedArgs[0]} failed`, code: npmStep.code, rolledBack, restarted: false, before, after, mode, source });
    }

    // Post-update, pre-restart gate: syntax-check all sources + run a smoke test.
    // If anything is broken, revert to the pre-update state and do NOT restart.
    const validation = await validateUpdate(stream);
    if (!validation.ok) {
      stream({ type: 'log', msg: `[update] Validation failed: ${validation.error}. Rolling back...`, level: 'error' });
      const rolledBack = await rollback();
      if (rolledBack) {
        stream({ type: 'log', msg: '[update] Reinstalling dependencies for restored version...' });
        await installDependencies(stream);
      }
      return finish({ ok: false, error: `validation failed: ${validation.error}`, rolledBack, restarted: false, before, after, mode, source });
    }

    stream({ type: 'log', msg: '[update] Update completed successfully.' });
    if (!restart) {
      return finish({ ok: true, restarted: false, before, after, changed, mode, source });
    }

    scheduleSelfRestart();
    finish({ ok: true, restarted: true, before, after, changed, mode, source });
    setTimeout(() => {
      console.log('[proxy] restart requested after self-update; exiting process...');
      process.exit(0);
    }, 800);
  } catch (err) {
    finish({ ok: false, error: String(err.message || err) });
  }
}

function handleLaunchCommand(_req, res) {
  const port = parseInt(process.env.PORT || '8787', 10);
  const host = process.env.HOST || '127.0.0.1';
  const base = `http://${host}:${port}`;
  const npmPath = installer.which('npm');
  const claudePath = installer.detectClaude(npmPath);
  const claudeCmd  = claudePath || 'claude';
  const platform   = process.platform;
  const isWin      = platform === 'win32';

  // Collect directories that contain node/claude so a fresh terminal can find them.
  // claude is typically a shell script that calls `node` internally — node MUST be in PATH.
  const nodeBinDir  = path.dirname(process.execPath);
  const npmBinDir   = path.join(installer.NPM_PREFIX, isWin ? '' : 'bin');
  const portNodeDir = path.join(installer.NODE_DIR,   isWin ? '' : 'bin');
  const claudeDir   = claudePath ? path.dirname(claudePath) : null;
  // Also include the system npm global bin so a custom-prefixed install is found.
  const npmGlobalBinDir = npmPath ? installer.getNpmGlobalBinDir(npmPath) : null;

  // Deduplicate; always include so a fresh terminal with no custom PATH works.
  const pathDirs = [...new Set(
    [claudeDir, npmGlobalBinDir, npmBinDir, portNodeDir, nodeBinDir].filter(Boolean)
  )];

  const pathUnix = `export PATH="${pathDirs.join(':')}:$PATH"`;
  const pathPs   = `$env:PATH = "${pathDirs.join(';')};$env:PATH"`;
  const pathCmds = pathDirs.map(d => `set PATH=${d};%PATH%`);

  const unix = [
    `export ANTHROPIC_BASE_URL="${base}"`,
    `export ANTHROPIC_AUTH_TOKEN="proxy-max"`,
    `export ANTHROPIC_API_KEY="proxy-max"`,
    pathUnix,
    `${claudeCmd} --dangerously-skip-permissions`,
  ].join('\n');

  // Build the Windows PowerShell invocation.
  // .cmd files: & 'path\claude.cmd' works directly in PS.
  // .ps1 files: need -ExecutionPolicy Bypass to avoid unsigned-script blocks.
  let psClaudeInvoke;
  if (!claudePath) {
    psClaudeInvoke = `claude --dangerously-skip-permissions`;
  } else if (claudeCmd.toLowerCase().endsWith('.ps1')) {
    psClaudeInvoke = `powershell.exe -ExecutionPolicy Bypass -File '${claudeCmd.replace(/'/g, "''")}' --dangerously-skip-permissions`;
  } else {
    psClaudeInvoke = `& '${claudeCmd.replace(/'/g, "''")}' --dangerously-skip-permissions`;
  }

  const ps = [
    `$env:ANTHROPIC_BASE_URL = "${base}"`,
    `$env:ANTHROPIC_AUTH_TOKEN = "proxy-max"`,
    `$env:ANTHROPIC_API_KEY = "proxy-max"`,
    pathPs,
    psClaudeInvoke,
  ].join('\n');

  // cmd.exe — .ps1 needs a powershell wrapper; .cmd/.bat run directly.
  let cmdClaudeInvoke;
  if (!claudePath) {
    cmdClaudeInvoke = `claude --dangerously-skip-permissions`;
  } else if (claudeCmd.toLowerCase().endsWith('.ps1')) {
    cmdClaudeInvoke = `powershell.exe -ExecutionPolicy Bypass -File "${claudeCmd}" --dangerously-skip-permissions`;
  } else {
    cmdClaudeInvoke = `"${claudeCmd}" --dangerously-skip-permissions`;
  }

  const wincmd = [
    `set ANTHROPIC_BASE_URL=${base}`,
    `set ANTHROPIC_AUTH_TOKEN=proxy-max`,
    `set ANTHROPIC_API_KEY=proxy-max`,
    ...pathCmds,
    cmdClaudeInvoke,
  ].join(' && ');

  send(res, 200, {
    platform,
    claudeInstalled: !!claudePath,
    claudePath: claudePath || null,
    base,
    pathDirs,
    commands: { unix, ps, wincmd },
  });
}

function handlePoolGet(_req, res) {
  const now = Date.now();
  const pool = (CONFIG.pool || []).map(e => {
    const stat = poolStats.get(`${e.provider}::${e.model}`) || { req: 0, err: 0, lastMs: 0, consecutiveFails: 0, cooledUntil: 0 };
    return {
      ...e,
      stats: {
        req: stat.req,
        err: stat.err,
        lastMs: stat.lastMs,
        consecutiveFails: stat.consecutiveFails || 0,
        cooledUntil: stat.cooledUntil || 0,
        cooldownSecsLeft: stat.cooledUntil > now ? Math.ceil((stat.cooledUntil - now) / 1000) : 0
      }
    };
  });
  send(res, 200, { pool, rrIndex: poolRR, size: pool.length });
}

async function handlePoolPost(req, res) {
  const body = await readJSONBody(req);
  if (!Array.isArray(body.pool)) return send(res, 400, { error: 'pool must be an array' });
  const CRED_FIELDS = ['endpoint', 'apiKey', 'apiVersion', 'deployment', 'region', 'accessKeyId', 'secretAccessKey'];
  CONFIG.pool = body.pool
    .map(e => {
      const entry = { provider: e.provider, model: e.model, label: e.label || null };
      for (const f of CRED_FIELDS) {
        if (e[f] != null && e[f] !== '') entry[f] = e[f];
      }
      return entry;
    })
    .filter(e => e.provider && e.model);
  saveConfig(CONFIG);
  send(res, 200, { ok: true, pool: CONFIG.pool });
}

function handlePoolResetCircuits(_req, res) {
  for (const stat of poolStats.values()) {
    stat.consecutiveFails = 0;
    stat.cooledUntil = 0;
  }
  send(res, 200, { ok: true });
}

function handleLogsGet(_req, res) {
  send(res, 200, { logs: REQUEST_LOG.slice().reverse(), count: REQUEST_LOG.length });
}

function logFilesMetadata() {
  const logFiles = [];
  for (let i = 1; i <= LOG_KEEP_ROTATIONS; i++) {
    try { const s = fs.statSync(`${LOG_FILE}.${i}`); logFiles.push({ name: `requests.log.${i}`, bytes: s.size }); } catch {}
  }
  try { const s = fs.statSync(LOG_FILE); logFiles.unshift({ name: 'requests.log', bytes: s.size }); } catch {}
  return logFiles;
}

function readLogEntries(limit = 200) {
  const max = Math.min(5000, Math.max(1, Number(limit) || 200));
  return new Promise(resolve => {
    fs.readFile(LOG_FILE, 'utf8', (err, raw) => {
      if (err) { resolve({ logs: [], total: 0, limit: max, logFile: LOG_FILE, logFiles: [] }); return; }
      const lines = raw.split('\n').filter(Boolean);
      const tail  = lines.slice(-max).reverse();
      resolve({
        logs: tail.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } }),
        total: lines.length,
        limit: max,
        logFile: LOG_FILE,
        logFiles: logFilesMetadata(),
      });
    });
  });
}

// Serve the last N lines of the on-disk log file as a JSON array of parsed objects.
// ?lines=N (default 200, max 2000). Falls back gracefully if file doesn't exist yet.
async function handleLogsFileGet(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const limit = Math.min(2000, Math.max(1, parseInt(u.searchParams.get('lines') || '200', 10)));
  send(res, 200, await readLogEntries(limit));
}

async function handleDiagnosticsGet(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');
    const limit = Math.min(1000, Math.max(50, parseInt(u.searchParams.get('lines') || '400', 10)));
    const [{ logs, total, logFile, logFiles }, summary, modelRows, costRows, tokenRows, overview] = await Promise.all([
      readLogEntries(limit),
      handleDashboardSummaryData(),
      analytics.getModelBreakdown(null, pricingCalc),
      analytics.getProviderBreakdown(null, pricingCalc),
      analytics.getLifetimeStats(pricingCalc),
      analytics.getRequestHistory(null, 30),
    ]);
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;
    const recent = logs.filter(l => {
      const ts = l.ts || (l.time ? Date.parse(l.time) : 0);
      return ts && now - ts <= windowMs;
    });
    const failed = logs.filter(l => l.finalStatus && !['ok', 'cache-hit'].includes(l.finalStatus));
    const latencies = logs.map(l => Number(l.totalMs)).filter(Number.isFinite).filter(n => n >= 0);
    const byStatus = {};
    const byModel = {};
    const byProvider = {};
    const slow = logs.slice().sort((a, b) => (b.totalMs || 0) - (a.totalMs || 0)).slice(0, 20);
    for (const l of logs) {
      const status = l.finalStatus || l.status || 'unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
      const first = (l.attempts || []).find(a => a.status !== 'skipped') || {};
      const model = first.model || l.model || l.request?.model || 'unknown';
      const provider = first.provider || l.provider || 'unknown';
      byModel[model] = (byModel[model] || 0) + 1;
      byProvider[provider] = (byProvider[provider] || 0) + 1;
    }
    const cpus = os.cpus() || [];
    const cpuLoadPct = Math.round(((os.loadavg?.()[0] || 0) / Math.max(1, cpus.length)) * 100);
    const mem = process.memoryUsage();
    const health = {
      ok: failed.length === 0 || (failed.length / Math.max(1, logs.length)) < 0.05,
      status: failed.length ? 'watch' : 'healthy',
      provider: CONFIG.provider || null,
      poolSize: getPool().length,
      inFlight: currentInFlight(),
      cacheBackend: store.info().backend,
      uptimeSec: Math.round(process.uptime()),
      memory: mem,
      cpu: { cores: cpus.length, load1: os.loadavg?.()[0] || 0, loadPct: cpuLoadPct },
      disk: { logBytes: logFiles.reduce((s, f) => s + (f.bytes || 0), 0), dbFile: store.info().dbFile },
      network: { upstreamConnections: Number(process.env.PROXY_MAX_UPSTREAM_CONNECTIONS || 64), host: HOST, port: PORT },
    };
    const models = modelRows.map(m => ({
      ...m,
      category: inferModelProfile(m.model, m.provider).category,
      tags: inferModelProfile(m.model, m.provider).tags,
      cost_usd: (m.total_cost_nano / 1e9).toFixed(6),
      cost_formatted: pricingCalc.formatCost(m.total_cost_nano),
    }));
    send(res, 200, {
      timestamp: new Date().toISOString(),
      overview: {
        totalRequests: total,
        loadedRequests: logs.length,
        recentRequests1h: recent.length,
        failuresLoaded: failed.length,
        errorRate: logs.length ? Number((failed.length / logs.length).toFixed(3)) : 0,
        p50Ms: percentile(latencies, 0.50),
        p95Ms: percentile(latencies, 0.95),
        maxMs: latencies.length ? Math.max(...latencies) : 0,
        totalCostNano: tokenRows.total_cost_nano_usd || 0,
        totalTokens: (tokenRows.total_context_input_tokens || 0) + (tokenRows.total_output_tokens || 0),
      },
      health,
      models,
      metrics: {
        byStatus, byModel, byProvider, latencies,
        throughput: { loadedPerMinute: Number((logs.length / Math.max(1, ((latencies.length ? (Date.now() - Math.min(...logs.map(l => l.ts || Date.parse(l.time) || Date.now()).filter(Boolean))) : 60000) / 60000))).toFixed(2)), recentPerHour: recent.length },
        saturation: { inFlight: currentInFlight(), capacity: getPool().length * FANOUT.perMember, queued: OPT_STATS.fanoutQueued || 0 },
        fanout: summary.fanout, cache: summary.cache, optimization: summary.optimization
      },
      alerts: [
        { name: 'High error rate', severity: failed.length / Math.max(1, logs.length) > 0.05 ? 'critical' : 'ok', value: logs.length ? Number((failed.length / logs.length).toFixed(3)) : 0, rule: 'errorRate > 5%' },
        { name: 'High p95 latency', severity: percentile(latencies, 0.95) > 60000 ? 'warning' : 'ok', value: percentile(latencies, 0.95), rule: 'p95 > 60s' },
        { name: 'Queue timeouts', severity: (OPT_STATS.fanoutQueueTimeouts || 0) > 0 ? 'warning' : 'ok', value: OPT_STATS.fanoutQueueTimeouts || 0, rule: 'queueTimeouts > 0' },
        { name: 'Cache backend', severity: store.info().backend === 'sqlite' ? 'ok' : 'warning', value: store.info().backend, rule: 'sqlite preferred for high volume' },
      ],
      alertChannels: [{ name: 'Dashboard', enabled: true }, { name: 'Logs', enabled: true }, { name: 'Webhook', enabled: false }],
      errors: failed.slice(0, 100),
      slowRequests: slow,
      requests: logs,
      traces: logs.slice(0, 100).map(l => ({ id: l.id, time: l.time || (l.ts ? new Date(l.ts).toISOString() : null), status: l.finalStatus || l.status, totalMs: l.totalMs, request: l.request, attempts: l.attempts || [], error: l.error || null, responseCapture: l.responseCapture || null, fanout: l.fanout || null })),
      cost: { byProvider: costRows, byModel: models, lifetime: tokenRows },
      recentAnalytics: overview,
      logs: { logFile, logFiles, total },
      system: { node: process.version, platform: process.platform, arch: process.arch, pid: process.pid, cwd: ROOT, configPath: CONFIG_PATH, logDir: LOG_DIR, store: store.info() },
    });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}

function handleLogsClear(_req, res) {
  REQUEST_LOG.length = 0;
  // Also truncate the log file and all rotations.
  try { fs.writeFileSync(LOG_FILE, '', 'utf8'); } catch {}
  for (let i = 1; i <= LOG_KEEP_ROTATIONS; i++) {
    try { fs.unlinkSync(`${LOG_FILE}.${i}`); } catch {}
  }
  send(res, 200, { ok: true });
}

function serveStatic(req, res) {
  let p = new URL(req.url, 'http://localhost').pathname;
  if (p === '/' || p === '/ui') p = '/ui/index.html';
  const filePath = path.join(ROOT, p);
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'not found');
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// Anthropic /v1/models response — Claude Code may query this to confirm the API is reachable.
function handleV1Models(_req, res) {
  // Surface a realistic-looking Claude model list so Claude Code doesn't fall into
  // degraded mode. The actual upstream model is transparent to the CLI.
  // Include max_input_tokens, max_tokens, capabilities so the SDK can use them.
  // Capabilities must reflect every pool member a request could actually land on
  // (fanout can mix provider kinds), not just the single "active" CONFIG.provider —
  // otherwise Claude Code could be told a capability is available when only some
  // pool members actually support it. Advertise a capability only if ALL members
  // that could serve a request support it (conservative intersection).
  const pool = getPool();
  const kinds = pool.length ? pool.map(p => p.kind) : [CONFIG.provider];
  const allKindsSupport = (fn) => kinds.length > 0 && kinds.every(fn);
  const supportsComputerUse   = allKindsSupport(k => k === 'bedrock');
  const supportsThinking      = allKindsSupport(k => k !== 'nvidia');
  const supportsPromptCaching = allKindsSupport(k => k !== 'nvidia' && k !== 'cloudflare');
  const supportsVision        = allKindsSupport(k => k !== 'nvidia');

  const data = [
    { type: 'model', id: 'claude-sonnet-5',            display_name: 'Claude Sonnet 5',            created_at: '2026-06-30T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-fable-5',             display_name: 'Claude Fable 5',             created_at: '2026-06-09T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-mythos-5',            display_name: 'Claude Mythos 5',            created_at: '2026-06-09T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-mythos-preview',      display_name: 'Claude Mythos Preview',      created_at: '2026-04-07T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-opus-4-8',            display_name: 'Claude Opus 4.8',            created_at: '2026-05-28T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-opus-4-7',            display_name: 'Claude Opus 4.7',            created_at: '2026-04-16T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-opus-4-6',            display_name: 'Claude Opus 4.6',            created_at: '2026-02-05T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-sonnet-4-6',          display_name: 'Claude Sonnet 4.6',          created_at: '2026-02-17T00:00:00Z', max_input_tokens: 1000000, max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: false, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-haiku-4-5',           display_name: 'Claude Haiku 4.5',           created_at: '2025-10-15T00:00:00Z', max_input_tokens: 200000,  max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: false, computer_use: false, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-haiku-4-5-20251001',  display_name: 'Claude Haiku 4.5 (dated)',   created_at: '2025-10-01T00:00:00Z', max_input_tokens: 200000,  max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: false, computer_use: false, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-opus-4-5',            display_name: 'Claude Opus 4.5',            created_at: '2025-11-24T00:00:00Z', max_input_tokens: 200000,  max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-opus-4-5-20251101',   display_name: 'Claude Opus 4.5 (dated)',    created_at: '2025-11-01T00:00:00Z', max_input_tokens: 200000,  max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-sonnet-4-5',          display_name: 'Claude Sonnet 4.5',          created_at: '2025-09-29T00:00:00Z', max_input_tokens: 200000,  max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: false, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5 (dated)',  created_at: '2025-09-29T00:00:00Z', max_input_tokens: 200000,  max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: false, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-opus-4-1',            display_name: 'Claude Opus 4.1',            created_at: '2025-08-05T00:00:00Z', max_input_tokens: 200000,  max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
    { type: 'model', id: 'claude-opus-4-1-20250805',   display_name: 'Claude Opus 4.1 (dated)',    created_at: '2025-08-05T00:00:00Z', max_input_tokens: 200000,  max_tokens: 64000,  capabilities: { vision: supportsVision, tool_use: true, extended_thinking: supportsThinking, computer_use: supportsComputerUse, prompt_caching: supportsPromptCaching } },
  ];
  send(res, 200, { data, has_more: false, first_id: data[0].id, last_id: data[data.length - 1].id });
}

const server = http.createServer({ keepAlive: true }, async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  // CORS — Claude Code and browser-based tests may call from different origins.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta');
  // request-id — echo back client's id if provided, otherwise generate one.
  const clientReqId = req.headers['request-id'] || req.headers['x-request-id'];
  const proxyReqId = clientReqId || `proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  res.setHeader('request-id', proxyReqId);
  res.setHeader('x-request-id', proxyReqId);
  // anthropic-version — expected by Claude Code SDK on every response.
  res.setHeader('anthropic-version', '2023-06-01');
  res.setHeader('cache-control', 'private, no-cache');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    if (req.method === 'POST' && (u.pathname === '/v1/messages' || u.pathname === '/messages')) {
      return await handleMessages(req, res);
    }
    if (req.method === 'POST' && u.pathname === '/v1/messages/count_tokens') {
      return await handleCountTokens(req, res);
    }
    // /v1/models — Claude Code Anthropic SDK may query this on startup.
    if (u.pathname === '/v1/models' && req.method === 'GET') return handleV1Models(req, res);
    if (u.pathname === '/api/models') {
      const forceRefresh = u.searchParams.get('refresh') === '1';
      const catalog = {
        ...MODELS,
        bedrock: MODELS.bedrock,
        azure: MODELS.azure,
        nvidia: MODELS.nvidia,
        cloudflare: MODELS.cloudflare,
      };
      const nvidiaApiKey = CONFIG?.providers?.nvidia?.apiKey;
      if (nvidiaApiKey) {
        try {
          const liveNvidia = await fetchLiveNvidiaModelGroups(nvidiaApiKey, { forceRefresh });
          if (liveNvidia && liveNvidia.length) {
            catalog.nvidia = liveNvidia;
          }
        } catch (err) {
          console.warn(`[proxy] [nvidia-model-sync] ${err.message}`);
        }
      }
      return send(res, 200, catalog);
    }
    if (u.pathname === '/api/system' && req.method === 'GET') return await handleSystem(req, res);
    if (u.pathname === '/api/install' && req.method === 'POST') return await handleInstall(req, res);
    if (u.pathname === '/api/update' && req.method === 'POST') return await handleSelfUpdate(req, res);
    if (u.pathname === '/api/update/check' && req.method === 'GET') return await handleUpdateCheck(req, res);    if (u.pathname === '/api/config' && req.method === 'GET') return handleConfigGet(req, res);
    if (u.pathname === '/api/config' && req.method === 'POST') return await handleConfigPost(req, res);
    if (u.pathname === '/api/test' && req.method === 'POST') return await handleTest(req, res);
    if (u.pathname === '/api/limits' && req.method === 'GET') return handleLimitsGet(req, res);
    if (u.pathname === '/api/limits' && req.method === 'POST') return await handleLimitsPost(req, res);
    if (u.pathname === '/api/compression' && req.method === 'GET') return handleCompressionGet(req, res);
    if (u.pathname === '/api/compression' && req.method === 'POST') return await handleCompressionPost(req, res);
    if (u.pathname === '/api/optimization' && req.method === 'GET') return handleOptimizationGet(req, res);
    if (u.pathname === '/api/optimization' && req.method === 'POST') return await handleOptimizationPost(req, res);
    if (u.pathname === '/api/optimization/stats' && req.method === 'GET') return handleOptimizationStats(req, res);
    if (u.pathname === '/api/cache/clear' && req.method === 'POST') return handleCacheClear(req, res);
    if (u.pathname === '/api/analytics' && req.method === 'GET') return await handleAnalyticsGet(req, res);
    if (u.pathname === '/api/dashboard/summary' && req.method === 'GET') return await handleDashboardSummary(req, res);
    if (u.pathname === '/api/diagnostics' && req.method === 'GET') return await handleDiagnosticsGet(req, res);
    if (u.pathname === '/api/pool' && req.method === 'GET') return handlePoolGet(req, res);
    if (u.pathname === '/api/pool' && req.method === 'POST') return await handlePoolPost(req, res);
    if (u.pathname === '/api/pool/reset-circuits' && req.method === 'POST') return handlePoolResetCircuits(req, res);
    if (u.pathname === '/api/logs' && req.method === 'GET') return handleLogsGet(req, res);
    if (u.pathname === '/api/logs/file' && req.method === 'GET') return handleLogsFileGet(req, res);
    if (u.pathname === '/api/logs/clear' && req.method === 'POST') return handleLogsClear(req, res);
    if (u.pathname === '/api/health') {
      const pool = getPool();
      const poolMode = Array.isArray(CONFIG.pool) && CONFIG.pool.length > 0;
      return send(res, 200, {
        ok: true,
        provider: CONFIG.provider,
        model: activeProviderConfig()?.model,
        poolMode,
        poolSize: poolMode ? CONFIG.pool.length : 0,
        poolActive: [...poolStats.values()].filter(s => s.req > 0).length
      });
    }
    if (u.pathname === '/api/launch/command' && req.method === 'GET') return handleLaunchCommand(req, res);
    if (u.pathname === '/api/reload') { CONFIG = loadConfig(); return send(res, 200, { ok: true }); }

    // ---- Dashboard analytics routes (read-only data for the Dashboard tab) ----
    const dashKey = `${req.method} ${u.pathname}`;
    if (DASHBOARD_ROUTES[dashKey]) return DASHBOARD_ROUTES[dashKey](req, res, dashDeps);

    // Legacy redirect: the dashboard now lives as a tab in the main UI.
    if (u.pathname === '/dashboard' && req.method === 'GET') {
      res.writeHead(302, { Location: '/#dashboard' });
      return res.end();
    }

    return serveStatic(req, res);
  } catch (err) {
    console.error('[proxy] unhandled:', err);
    if (!res.headersSent) send(res, 500, { error: String(err.message || err) });
  }
});

// Sub-agents maintain persistent HTTP connections and fire many requests per
// session. Keep connections alive long enough that they don't need to re-connect
// for every request. keepAliveTimeout > typical upstream idle timeout (60s).
server.keepAliveTimeout = 65000;
server.headersTimeout   = 70000;

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '127.0.0.1';

analytics.startSession();

server.listen(PORT, HOST, () => {
  const address = server.address();
  const shownPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`\nProxy-Max running`);
  console.log(`  UI:        http://${HOST}:${shownPort}/  (dashboard, optimization & config all here)`);
  console.log(`  API base:  http://${HOST}:${shownPort}  (point ANTHROPIC_BASE_URL here)`);
  console.log(`  Config:    ${CONFIG_PATH}`);
  console.log(`  Log file:  ${LOG_FILE}  (tail -f for live view)`);
  if (CONFIG.provider) {
    const ac = activeProviderConfig();
    console.log(`  Active:    ${CONFIG.provider} / ${ac?.model || '(no model selected)'}`);
  } else {
    console.log(`  Active:    (none — open the UI to configure)`);
  }
});

process.on('SIGINT', async () => {
  console.log('\n[proxy] shutting down...');
  try {
    analytics.flush();
    await analytics.endSession();
    await analytics.close();
  } catch (e) {
    console.error('[proxy] analytics shutdown error:', e.message);
  }
  server.close(() => process.exit(0));
});

module.exports = { server, getPool, poolRuntimeSnapshot, OPT_STATS };
