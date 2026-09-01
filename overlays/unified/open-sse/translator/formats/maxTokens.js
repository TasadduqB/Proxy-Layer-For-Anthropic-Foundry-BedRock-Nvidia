import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig.js";

/**
 * Adjust max_tokens based on request context
 * @param {object} body - Request body
 * @param {number} [ceiling=DEFAULT_MAX_TOKENS] - Upper bound for max_tokens.
 *   Callers with model context (e.g. openai-to-claude) pass the model's real
 *   maxOutput so high-output models (Opus 4.8 = 128000) aren't pre-clamped to
 *   the conservative 64000 default before the model-aware step sees them.
 * @returns {number} Adjusted max_tokens
 */
export function adjustMaxTokens(body, ceiling = DEFAULT_MAX_TOKENS) {
  let maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS;

  // Auto-increase for tool calling to prevent truncated arguments (min never above max)
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    if (maxTokens < DEFAULT_MIN_TOKENS) {
      maxTokens = DEFAULT_MIN_TOKENS;
    }
  }

  // Ensure max_tokens > thinking.budget_tokens (Claude API requirement)
  // Claude API requires strictly greater, so add buffer instead of using the
  // ceiling which could equal budget_tokens when budget_tokens >= ceiling.
  // Guard against a client-supplied budget_tokens that's already negative or
  // non-finite (observed on very long conversations, where the client's own
  // "remaining budget" math can go negative) — trusting it verbatim here would
  // forward a negative max_tokens to every upstream, guaranteeing a 400 on
  // every combo member instead of just this one request adjusting gracefully.
  const budgetTokens = Number(body.thinking?.budget_tokens);
  if (Number.isFinite(budgetTokens) && budgetTokens > 0 && maxTokens <= budgetTokens) {
    maxTokens = budgetTokens + 1024;
  }

  // Never exceed the ceiling, and never fall to zero/negative regardless of
  // how we got here.
  if (maxTokens > ceiling) maxTokens = ceiling;
  if (!Number.isFinite(maxTokens) || maxTokens < 1) maxTokens = DEFAULT_MAX_TOKENS;

  return maxTokens;
}

