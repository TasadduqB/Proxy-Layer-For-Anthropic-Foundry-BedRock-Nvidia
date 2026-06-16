/**
 * Dashboard API Routes - plain http handler functions (no Express)
 *
 * Exports an object keyed by "METHOD /path".
 * Each value is: async (req, res, { analytics, tokenCounter, pricingCalc, compressor }) => void
 *
 * Handlers use res.writeHead + res.end instead of res.json / res.status.
 */

const { OutputFilter, BUILTIN_FILTERS } = require('../output-filters/filter');

// ---- helpers ----

function jsonOk(res, body) {
  const data = JSON.stringify(body);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(data);
}

function jsonErr(res, status, message) {
  const data = JSON.stringify({ error: message });
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// ---- route handlers ----

const DASHBOARD_ROUTES = {

  // === OVERVIEW TAB ===
  'GET /api/dashboard/overview': async (req, res, { analytics }) => {
    try {
      const sessionStats    = await analytics.getSessionStats();
      const lifetimeStats   = await analytics.getLifetimeStats();
      const requestHistory  = await analytics.getRequestHistory(null, 10);
      jsonOk(res, {
        current_session: sessionStats,
        lifetime: lifetimeStats,
        recent_requests: requestHistory,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  // === TOKEN USAGE TAB ===
  'GET /api/dashboard/token-usage': async (req, res, { analytics }) => {
    try {
      const modelBreakdown    = await analytics.getModelBreakdown();
      const compressionStats  = await analytics.getCompressionStats();
      const formatted = modelBreakdown.map(m => ({
        ...m,
        reduction_pct: m.tokens_saved && m.original_tokens
          ? ((m.tokens_saved / m.original_tokens) * 100).toFixed(1)
          : '0',
      }));
      jsonOk(res, { by_model: formatted, by_compression_mode: compressionStats });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  // === COST ANALYTICS TAB ===
  'GET /api/dashboard/cost-analytics': async (req, res, { analytics, pricingCalc }) => {
    try {
      const providerBreakdown = await analytics.getProviderBreakdown();
      const modelBreakdown    = await analytics.getModelBreakdown();
      const lifetimeStats     = await analytics.getLifetimeStats();
      jsonOk(res, {
        by_provider: providerBreakdown.map(p => ({
          ...p,
          cost_usd: (p.total_cost_nano / 1e9).toFixed(6),
          cost_formatted: pricingCalc.formatCost(p.total_cost_nano),
        })),
        by_model: modelBreakdown.map(m => ({
          ...m,
          cost_usd: (m.total_cost_nano / 1e9).toFixed(6),
          cost_formatted: pricingCalc.formatCost(m.total_cost_nano),
        })),
        lifetime_summary: {
          total_cost_nano: lifetimeStats.total_cost_nano_usd || 0,
          total_cost_usd: ((lifetimeStats.total_cost_nano_usd || 0) / 1e9).toFixed(6),
          total_tokens_saved: lifetimeStats.total_tokens_saved || 0,
          estimated_savings_usd: (((lifetimeStats.total_tokens_saved || 0) * 0.003) / 1e6).toFixed(6),
        },
      });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  // === COMPRESSION SETTINGS TAB ===
  'POST /api/dashboard/test-compression': async (req, res, { compressor }) => {
    try {
      const { text, modes = ['lite', 'full', 'ultra'] } = await readBody(req);
      if (!text) return jsonErr(res, 400, 'text required');
      jsonOk(res, compressor.previewModes(text, modes));
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  'POST /api/dashboard/compress-text': async (req, res, { compressor }) => {
    try {
      const { text, mode = 'full' } = await readBody(req);
      if (!text) return jsonErr(res, 400, 'text required');
      const compressed = compressor.compress(text, mode);
      const stats = compressor.getCompressionStats(text, compressed);
      jsonOk(res, { original: text, compressed, stats });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  // === CLI FILTERS TAB ===
  'POST /api/dashboard/test-filter': async (req, res) => {
    try {
      const { output, filterName = null, filterConfig = null } = await readBody(req);
      if (!output) return jsonErr(res, 400, 'output required');

      let filter;
      if (filterName && BUILTIN_FILTERS[filterName]) {
        filter = new OutputFilter(BUILTIN_FILTERS[filterName]);
      } else if (filterConfig) {
        filter = new OutputFilter(filterConfig);
      } else {
        filter = new OutputFilter();
      }

      const filtered = filter.apply(output);
      jsonOk(res, {
        original_lines:  output.split('\n').length,
        original_length: output.length,
        filtered_lines:  filtered.split('\n').length,
        filtered_length: filtered.length,
        reduction_pct:   ((output.length - filtered.length) / output.length * 100).toFixed(1),
        filtered_output: filtered.substring(0, 10000),
      });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  'GET /api/dashboard/builtin-filters': (req, res) => {
    jsonOk(res, { available_filters: Object.keys(BUILTIN_FILTERS), filters: BUILTIN_FILTERS });
  },

  // === TOKEN COUNTER TAB ===
  'POST /api/dashboard/estimate-tokens': async (req, res, { tokenCounter }) => {
    try {
      const { text, provider = 'openai', model = 'gpt-4o' } = await readBody(req);
      if (!text) return jsonErr(res, 400, 'text required');
      const tokens = tokenCounter.estimateTokens(text, { provider, model });
      jsonOk(res, { text_length: text.length, estimated_tokens: tokens, tokens_per_char: (tokens / text.length).toFixed(3) });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  // === COST CALCULATOR TAB ===
  'POST /api/dashboard/calculate-cost': async (req, res, { pricingCalc }) => {
    try {
      const { inputTokens, outputTokens, modelName, cachedTokens = 0 } = await readBody(req);
      if (inputTokens == null || outputTokens == null || !modelName) {
        return jsonErr(res, 400, 'inputTokens, outputTokens, modelName required');
      }
      const result = pricingCalc.calculateCostNano(inputTokens, outputTokens, modelName, { cachedTokens });
      if (result.error) return jsonErr(res, 400, result.error);
      jsonOk(res, {
        model: modelName,
        input_tokens:   inputTokens,
        output_tokens:  outputTokens,
        cached_tokens:  cachedTokens,
        total_tokens:   inputTokens + outputTokens,
        cost_usd:       result.cost_usd.toFixed(9),
        cost_nano_usd:  result.cost_nano_usd,
        cost_formatted: pricingCalc.formatCost(result.cost_nano_usd),
        breakdown:      result.breakdown,
      });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  'GET /api/dashboard/supported-models': (req, res, { pricingCalc }) => {
    jsonOk(res, { models: pricingCalc.listModels() });
  },

  // === OPTIMIZATION SUGGESTIONS TAB ===
  'GET /api/dashboard/optimization-opportunities': async (req, res, { analytics }) => {
    try {
      const opportunities = await analytics.getOptimizationOpportunities(20);
      jsonOk(res, {
        opportunities,
        total_potential_savings: opportunities.reduce((sum, opp) => sum + opp.savings_pct, 0),
      });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  // === SESSION HISTORY TAB ===
  'GET /api/dashboard/session-history': async (req, res, { analytics }) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const history = await analytics.getRequestHistory(null, limit);
      jsonOk(res, { history, count: history.length });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

  // === STATS TAB ===
  'GET /api/dashboard/stats': async (req, res, { analytics }) => {
    try {
      const [sessionStats, lifetimeStats, compressionStats, providerBreakdown] = await Promise.all([
        analytics.getSessionStats(),
        analytics.getLifetimeStats(),
        analytics.getCompressionStats(),
        analytics.getProviderBreakdown(),
      ]);
      jsonOk(res, {
        current_session: sessionStats,
        lifetime:        lifetimeStats,
        compression:     compressionStats,
        providers:       providerBreakdown,
      });
    } catch (err) {
      jsonErr(res, 500, err.message);
    }
  },

};

module.exports = DASHBOARD_ROUTES;
