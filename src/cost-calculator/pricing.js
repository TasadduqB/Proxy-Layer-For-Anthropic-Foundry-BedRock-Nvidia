/**
 * Pricing Database - All major LLM provider model prices
 * Prices in $/1M tokens (USD)
 * Updated: June 2026
 */

const PRICING_MODELS = {
  // OpenAI - GPT-4o series
  'gpt-4o': {
    input: 2.50,
    output: 10.00,
    cached_input: 1.25,
    long_context_threshold: 272000,
    long_input: 7.50,
    long_output: 30.00,
  },
  'gpt-4o-2024-11-20': {
    input: 2.50,
    output: 10.00,
    cached_input: 1.25,
  },
  'gpt-4o-mini': {
    input: 0.15,
    output: 0.60,
    cached_input: 0.075,
  },
  'gpt-4-turbo': {
    input: 10.00,
    output: 30.00,
    cached_input: 5.00,
  },
  'gpt-3.5-turbo': {
    input: 0.50,
    output: 1.50,
  },

  // Anthropic - Claude series
  'claude-3-5-sonnet': {
    input: 3.00,
    output: 15.00,
    cached_input: 0.30,
    long_context_threshold: 200000,
    long_input: 9.00,
    long_output: 45.00,
  },
  'claude-3-5-sonnet-20241022': {
    input: 3.00,
    output: 15.00,
    cached_input: 0.30,
  },
  'claude-3-opus': {
    input: 15.00,
    output: 75.00,
    cached_input: 1.50,
  },
  'claude-3-sonnet': {
    input: 3.00,
    output: 15.00,
    cached_input: 0.30,
  },
  'claude-3-haiku': {
    input: 0.80,
    output: 4.00,
    cached_input: 0.08,
  },

  // Google Gemini
  'gemini-2-flash': {
    input: 0.075,
    output: 0.30,
    cached_input: 0.0225,
  },
  'gemini-1-5-pro': {
    input: 1.25,
    output: 5.00,
    cached_input: 0.3125,
  },
  'gemini-1-5-flash': {
    input: 0.075,
    output: 0.30,
    cached_input: 0.0225,
  },

  // Reasoning models (o1, o3)
  'o1': {
    input: 15.00,
    output: 60.00,
  },
  'o3': {
    input: 40.00,
    output: 160.00,
  },
  'o3-mini': {
    input: 2.00,
    output: 8.00,
  },

  // AWS Bedrock (Claude via Bedrock)
  'bedrock-claude-3-5-sonnet': {
    input: 3.00,
    output: 15.00,
    cached_input: 0.30,
  },
  'bedrock-claude-3-opus': {
    input: 15.00,
    output: 75.00,
    cached_input: 1.50,
  },
  'bedrock-claude-3-haiku': {
    input: 0.80,
    output: 4.00,
    cached_input: 0.08,
  },

  // Azure Foundry (hosted models)
  'gpt-4-turbo-azure': {
    input: 12.00,
    output: 36.00,
  },
  'gpt-35-turbo-azure': {
    input: 0.50,
    output: 1.50,
  },

  // NVIDIA NIM
  'nvidia-llama-2-70b': {
    input: 0.5,
    output: 1.5,
  },
  'nvidia-mistral-7b': {
    input: 0.2,
    output: 0.6,
  },
};

class PricingCalculator {
  constructor() {
    this.models = PRICING_MODELS;
    this.version = 'jun-2026-1';
  }

  /**
   * Find pricing tier for a model (longest prefix match)
   */
  findModelPricing(modelName, exact = false) {
    if (!modelName) return null;

    // Exact match first
    if (this.models[modelName]) {
      return this.models[modelName];
    }

    if (exact) return null;

    // Longest prefix match (e.g., "gpt-4o-2024-11-20" matches "gpt-4o")
    const sorted = Object.keys(this.models).sort((a, b) => b.length - a.length);
    for (const key of sorted) {
      if (modelName.includes(key) || key.includes(modelName)) {
        return this.models[key];
      }
    }

    // Wildcard fallback
    return null;
  }

  /**
   * Calculate cost in nanoUSD (10^-9 USD) for atomic precision
   */
  calculateCostNano(inputTokens, outputTokens, modelName, options = {}) {
    const { cachedTokens = 0, isLongContext = false } = options;

    const pricing = this.findModelPricing(modelName);
    if (!pricing) {
      return { error: `Model pricing not found: ${modelName}` };
    }

    let costUsd = 0;

    if (isLongContext && pricing.long_context_threshold && inputTokens > pricing.long_context_threshold) {
      // Long context tier
      const uncachedInput = inputTokens - cachedTokens;
      const longInput = uncachedInput - pricing.long_context_threshold;
      const shortInput = uncachedInput - longInput;

      costUsd += (shortInput / 1e6) * pricing.input;
      costUsd += (longInput / 1e6) * (pricing.long_input || pricing.input);
      costUsd += (cachedTokens / 1e6) * (pricing.cached_input || pricing.input * 0.1);
      costUsd += (outputTokens / 1e6) * (pricing.long_output || pricing.output);
    } else {
      // Standard tier
      const uncachedInput = inputTokens - cachedTokens;
      costUsd += (uncachedInput / 1e6) * pricing.input;
      costUsd += (cachedTokens / 1e6) * (pricing.cached_input || pricing.input * 0.1);
      costUsd += (outputTokens / 1e6) * pricing.output;
    }

    // Convert to nanoUSD (avoid floating point precision issues)
    const costNano = Math.round(costUsd * 1e9);

    return {
      cost_usd: costUsd,
      cost_nano_usd: costNano,
      breakdown: {
        input_cost: (uncachedInput / 1e6) * pricing.input,
        cached_cost: (cachedTokens / 1e6) * (pricing.cached_input || pricing.input * 0.1),
        output_cost: (outputTokens / 1e6) * pricing.output,
      },
    };
  }

  /**
   * Format nanoUSD to readable string
   */
  formatCost(nanoUsd) {
    const usd = nanoUsd / 1e9;
    if (usd < 0.001) return `$${(usd * 1e6).toFixed(2)}µ`; // Micro USD
    if (usd < 0.01) return `$${(usd * 1e3).toFixed(2)}m`; // Milli USD
    return `$${usd.toFixed(6)}`;
  }

  /**
   * Estimate savings from token reduction
   */
  calculateSavings(originalTokens, reducedTokens, modelName) {
    const full = this.calculateCostNano(originalTokens, 0, modelName);
    const reduced = this.calculateCostNano(reducedTokens, 0, modelName);

    if (full.error || reduced.error) return { error: 'Pricing lookup failed' };

    const savingsNano = full.cost_nano_usd - reduced.cost_nano_usd;
    const reductionPct = ((originalTokens - reducedTokens) / originalTokens) * 100;

    return {
      original_tokens: originalTokens,
      reduced_tokens: reducedTokens,
      tokens_saved: originalTokens - reducedTokens,
      reduction_pct: reductionPct.toFixed(1),
      original_cost: this.formatCost(full.cost_nano_usd),
      reduced_cost: this.formatCost(reduced.cost_nano_usd),
      savings_nano: savingsNano,
      savings: this.formatCost(savingsNano),
    };
  }

  /**
   * List all supported models
   */
  listModels() {
    return Object.keys(this.models).sort();
  }
}

module.exports = PricingCalculator;
