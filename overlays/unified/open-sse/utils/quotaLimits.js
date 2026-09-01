const DAY_MS = 24 * 60 * 60 * 1000;

// A provider saying that it has no route/channel for a model is not a brief
// connection wobble. Keep that model out of managed combos long enough for a
// catalog or provider-capacity change, instead of probing every API key again
// on the next Claude goal turn.
export const MODEL_UNAVAILABLE_COOLDOWN_MS = 30 * 60 * 1000;

// Account fallback uses short exponential delays to rotate independent keys.
// Once every key for a model has returned 429, however, the combo circuit
// breaker needs a meaningfully longer window or a five-second goal recovery
// loop immediately selects the same exhausted model again.
export const UNSPECIFIED_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;

// Reject obviously corrupt/provider-bug reset values while still supporting
// daily and weekly quota windows.
export const MAX_REPORTED_QUOTA_COOLDOWN_MS = 8 * DAY_MS;

const RESET_HEADER_NAMES = [
  "x-ratelimit-reset",
  "x-rate-limit-reset",
  "ratelimit-reset",
  "retry-after",
];

function parseResetValue(value, now, relativeSeconds = false) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (relativeSeconds) return now + numeric * 1000;
    if (numeric >= 1e12) return numeric;
    if (numeric >= 1e9) return numeric * 1000;
    return now + numeric * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function readCaseInsensitive(object, wantedName) {
  if (!object || typeof object !== "object") return null;
  const match = Object.keys(object).find(
    (key) => key.toLowerCase() === wantedName.toLowerCase(),
  );
  return match ? object[match] : null;
}

/**
 * Extract an absolute reset timestamp from standard headers and provider JSON.
 * OpenRouter commonly places X-RateLimit-Reset inside error.metadata.headers.
 */
export function extractQuotaResetAtMs(response, payload = null, now = Date.now()) {
  const candidates = [];
  for (const name of RESET_HEADER_NAMES) {
    const value = response?.headers?.get?.(name);
    const parsed = parseResetValue(value, now, name === "retry-after");
    if (parsed) candidates.push(parsed);
  }

  const nestedHeaders = [
    payload?.headers,
    payload?.metadata?.headers,
    payload?.error?.headers,
    payload?.error?.metadata?.headers,
  ];
  for (const headers of nestedHeaders) {
    for (const name of RESET_HEADER_NAMES) {
      const value = readCaseInsensitive(headers, name);
      const parsed = parseResetValue(value, now, name === "retry-after");
      if (parsed) candidates.push(parsed);
    }
  }

  const absoluteFields = [
    payload?.reset_at,
    payload?.resets_at,
    payload?.resetAt,
    payload?.resetsAt,
    payload?.error?.reset_at,
    payload?.error?.resets_at,
    payload?.error?.resetAt,
    payload?.error?.resetsAt,
  ];
  for (const value of absoluteFields) {
    const parsed = parseResetValue(value, now);
    if (parsed) candidates.push(parsed);
  }

  const relativeFields = [
    payload?.retry_after,
    payload?.retryAfter,
    payload?.resets_in_seconds,
    payload?.error?.retry_after,
    payload?.error?.retryAfter,
    payload?.error?.resets_in_seconds,
  ];
  for (const value of relativeFields) {
    const parsed = parseResetValue(value, now, true);
    if (parsed) candidates.push(parsed);
  }

  const valid = candidates.filter(
    (timestamp) => timestamp > now && timestamp - now <= MAX_REPORTED_QUOTA_COOLDOWN_MS,
  );
  return valid.length > 0 ? Math.max(...valid) : null;
}

export function classifyQuotaScope(provider, status, errorText) {
  const providerId = String(provider || "").toLowerCase();
  const text = String(errorText || "").toLowerCase();
  const quotaFailure = Number(status) === 429
    || /rate limit|too many requests|quota|usage limit|limit exceeded/.test(text);
  if (!quotaFailure) return null;

  // OpenRouter's free request allowance is shared across all :free models for
  // an API key, so a failure here must lock the account, not just one model.
  if (
    providerId === "openrouter"
    && (
      /free-models-per-day/.test(text)
      || /free model requests per day/.test(text)
      || /free[- ]tier daily/.test(text)
    )
  ) return "provider";

  // OpenCode Zen's anonymous/free allowance is shared by its public endpoint.
  // A generic 429 without an explicit model qualifier should therefore remove
  // the provider briefly instead of probing every free model in sequence.
  if (
    providerId === "opencode"
    && Number(status) === 429
    && !/\bmodel\b.{0,30}(?:rate limit|quota|limit exceeded)/.test(text)
  ) return "provider";

  if (
    /(?:account|api key|provider|global).{0,40}(?:daily|weekly|monthly|quota|limit)/.test(text)
    || /(?:daily|weekly|monthly).{0,40}(?:account|api key|provider|global|total)/.test(text)
  ) return "provider";

  return "model";
}

export function isProviderModelUnavailable(status, errorText) {
  const code = Number(status);
  const text = String(errorText || "").toLowerCase();
  if (code === 410) {
    return /\bend of life\b|\bno longer available\b|\bretired\b|\bgone\b/.test(text);
  }
  if (![404, 503].includes(code)) return false;
  return /\bmodel_not_found\b|\bmodel not found\b|\bno available channel\b|\bno channel available\b|\bmodel (?:is )?(?:currently )?unavailable\b|\bfunction\b.{0,100}\bnot found for account\b/.test(text);
}

export function fallbackQuotaResetAtMs(status, errorText, now = Date.now()) {
  const text = String(errorText || "").toLowerCase();
  if (
    Number(status) === 429
    && /per day|daily limit|daily quota|free-models-per-day/.test(text)
  ) {
    return now + DAY_MS;
  }
  return null;
}
