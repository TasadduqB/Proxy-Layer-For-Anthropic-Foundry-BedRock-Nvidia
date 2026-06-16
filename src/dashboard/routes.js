/**
 * Dashboard API Routes
 * All endpoints for the unified dashboard
 */

const TokenCounter = require('../token-analyzer/counter');
const PricingCalculator = require('../cost-calculator/pricing');
const ProseCompressor = require('../compression/prose-compressor');
const { OutputFilter, BUILTIN_FILTERS } = require('../output-filters/filter');

let analytics = null; // Will be injected from main server

/**
 * Register all dashboard routes
 */
function registerDashboardRoutes(app, analyticsEngine) {
  analytics = analyticsEngine;
  const tokenCounter = new TokenCounter();
  const pricingCalc = new PricingCalculator();
  const compressor = new ProseCompressor();

  // === OVERVIEW TAB ===
  app.get('/api/dashboard/overview', async (req, res) => {
    try {
      const sessionStats = await analytics.getSessionStats();
      const lifetimeStats = await analytics.getLifetimeStats();
      const requestHistory = await analytics.getRequestHistory(null, 10);

      res.json({
        current_session: sessionStats,
        lifetime: lifetimeStats,
        recent_requests: requestHistory,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === TOKEN USAGE TAB ===
  app.get('/api/dashboard/token-usage', async (req, res) => {
    try {
      const modelBreakdown = await analytics.getModelBreakdown();
      const compressionStats = await analytics.getCompressionStats();

      const formatted = modelBreakdown.map(m => ({
        ...m,
        reduction_pct: m.tokens_saved && m.original_tokens
          ? ((m.tokens_saved / m.original_tokens) * 100).toFixed(1)
          : '0',
      }));

      res.json({
        by_model: formatted,
        by_compression_mode: compressionStats,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === COST ANALYTICS TAB ===
  app.get('/api/dashboard/cost-analytics', async (req, res) => {
    try {
      const providerBreakdown = await analytics.getProviderBreakdown();
      const modelBreakdown = await analytics.getModelBreakdown();
      const lifetimeStats = await analytics.getLifetimeStats();

      const formatted = {
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
      };

      res.json(formatted);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === COMPRESSION SETTINGS TAB ===
  app.post('/api/dashboard/test-compression', (req, res) => {
    try {
      const { text, modes = ['lite', 'full', 'ultra'] } = req.body;
      if (!text) return res.status(400).json({ error: 'text required' });

      const preview = compressor.previewModes(text, modes);
      res.json(preview);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/dashboard/compress-text', (req, res) => {
    try {
      const { text, mode = 'full' } = req.body;
      if (!text) return res.status(400).json({ error: 'text required' });

      const compressed = compressor.compress(text, mode);
      const stats = compressor.getCompressionStats(text, compressed);

      res.json({
        original: text,
        compressed: compressed,
        stats: stats,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === CLI FILTERS TAB ===
  app.post('/api/dashboard/test-filter', (req, res) => {
    try {
      const { output, filterName = null, filterConfig = null } = req.body;
      if (!output) return res.status(400).json({ error: 'output required' });

      let filter;
      if (filterName && BUILTIN_FILTERS[filterName]) {
        filter = new OutputFilter(BUILTIN_FILTERS[filterName]);
      } else if (filterConfig) {
        filter = new OutputFilter(filterConfig);
      } else {
        filter = new OutputFilter();
      }

      const filtered = filter.apply(output);

      res.json({
        original_lines: output.split('\n').length,
        original_length: output.length,
        filtered_lines: filtered.split('\n').length,
        filtered_length: filtered.length,
        reduction_pct: ((output.length - filtered.length) / output.length * 100).toFixed(1),
        filtered_output: filtered.substring(0, 10000), // Truncate preview
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dashboard/builtin-filters', (req, res) => {
    res.json({
      available_filters: Object.keys(BUILTIN_FILTERS),
      filters: BUILTIN_FILTERS,
    });
  });

  // === TOKEN COUNTER TAB ===
  app.post('/api/dashboard/estimate-tokens', (req, res) => {
    try {
      const { text, provider = 'openai', model = 'gpt-4o' } = req.body;
      if (!text) return res.status(400).json({ error: 'text required' });

      const tokens = tokenCounter.estimateTokens(text, { provider, model });

      res.json({
        text_length: text.length,
        estimated_tokens: tokens,
        tokens_per_char: (tokens / text.length).toFixed(3),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === COST CALCULATOR TAB ===
  app.post('/api/dashboard/calculate-cost', (req, res) => {
    try {
      const { inputTokens, outputTokens, modelName, cachedTokens = 0 } = req.body;
      if (inputTokens == null || outputTokens == null || !modelName) {
        return res.status(400).json({ error: 'inputTokens, outputTokens, modelName required' });
      }

      const result = pricingCalc.calculateCostNano(inputTokens, outputTokens, modelName, { cachedTokens });
      
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        model: modelName,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cached_tokens: cachedTokens,
        total_tokens: inputTokens + outputTokens,
        cost_usd: result.cost_usd.toFixed(9),
        cost_nano_usd: result.cost_nano_usd,
        cost_formatted: pricingCalc.formatCost(result.cost_nano_usd),
        breakdown: result.breakdown,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dashboard/supported-models', (req, res) => {
    res.json({
      models: pricingCalc.listModels(),
    });
  });

  // === OPTIMIZATION SUGGESTIONS TAB ===
  app.get('/api/dashboard/optimization-opportunities', async (req, res) => {
    try {
      const opportunities = await analytics.getOptimizationOpportunities(20);
      res.json({
        opportunities: opportunities,
        total_potential_savings: opportunities.reduce((sum, opp) => sum + opp.savings_pct, 0),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === SESSION HISTORY TAB ===
  app.get('/api/dashboard/session-history', async (req, res) => {
    try {
      const limit = req.query.limit || 50;
      const history = await analytics.getRequestHistory(null, limit);
      res.json({
        history: history,
        count: history.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === STATS TAB ===
  app.get('/api/dashboard/stats', async (req, res) => {
    try {
      const sessionStats = await analytics.getSessionStats();
      const lifetimeStats = await analytics.getLifetimeStats();
      const compressionStats = await analytics.getCompressionStats();
      const providerBreakdown = await analytics.getProviderBreakdown();

      res.json({
        current_session: sessionStats,
        lifetime: lifetimeStats,
        compression: compressionStats,
        providers: providerBreakdown,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('✓ Dashboard routes registered (12 tabs)');
}

module.exports = {
  registerDashboardRoutes,
};
