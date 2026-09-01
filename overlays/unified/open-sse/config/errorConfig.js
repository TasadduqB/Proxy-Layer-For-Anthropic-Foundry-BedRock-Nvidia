// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
  // A daily/monthly free-tier allotment being spent is not a "try again in a
  // few minutes" condition — the upstream will keep saying no until its own
  // reset window rolls over, which free providers virtually never report a
  // timestamp for. Exponential backoff (capped at BACKOFF_CONFIG.max = 5min)
  // would otherwise hammer an exhausted free key every 5 minutes forever.
  // Match MAX_RATE_LIMIT_COOLDOWN_MS so this never outlasts a provider that
  // *does* give us a concrete reset time via its own executor.
  exhausted: 30 * 60 * 1000,
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 *
 * Order matters — more specific "this is truly exhausted, not transient"
 * phrases are listed before the generic short-lived rate-limit phrases they'd
 * otherwise also satisfy (e.g. "daily quota exceeded" must not fall into the
 * generic "quota exceeded" backoff rule below it).
 */
export const ERROR_RULES = [
  // --- Long-cooldown exhaustion rules (checked first: most specific) ---
  // Free-tier community providers (HuggingFace, Groq, Gemini, Cerebras,
  // NVIDIA NIM, OpenRouter free models, Together, Cohere trial, etc.) each
  // phrase a spent daily/monthly allotment differently; none of them resolve
  // by retrying within minutes.
  { text: "daily limit",              cooldownMs: COOLDOWN.exhausted },
  { text: "daily quota",              cooldownMs: COOLDOWN.exhausted },
  { text: "monthly limit",            cooldownMs: COOLDOWN.exhausted },
  { text: "monthly quota",            cooldownMs: COOLDOWN.exhausted },
  { text: "resource_exhausted",       cooldownMs: COOLDOWN.exhausted },
  { text: "free tier limit",          cooldownMs: COOLDOWN.exhausted },
  { text: "free-tier limit",          cooldownMs: COOLDOWN.exhausted },
  { text: "trial has expired",        cooldownMs: COOLDOWN.exhausted },
  { text: "trial expired",            cooldownMs: COOLDOWN.exhausted },
  { text: "no credits",               cooldownMs: COOLDOWN.exhausted },
  { text: "insufficient credits",     cooldownMs: COOLDOWN.exhausted },
  { text: "credit balance",           cooldownMs: COOLDOWN.exhausted },
  { text: "out of credits",           cooldownMs: COOLDOWN.exhausted },
  { text: "insufficient_quota",       cooldownMs: COOLDOWN.exhausted },
  { text: "spending limit",           cooldownMs: COOLDOWN.exhausted },
  { text: "usage limit",              cooldownMs: COOLDOWN.exhausted },
  // Upstream's original "no credentials" text rule (kept identical).
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },

  // --- Short-lived transient rate limiting (backoff, retry soon) ---
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "requests per minute",      backoff: true },
  { text: "requests per second",      backoff: true },
  { text: "rpm limit",                backoff: true },
  { text: "tpm limit",                backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },
  { text: "try again later",          backoff: true },
  { text: "server is busy",           backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.exhausted },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 429, backoff: true },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.exhausted,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
  exhausted: COOLDOWN.exhausted,
};
