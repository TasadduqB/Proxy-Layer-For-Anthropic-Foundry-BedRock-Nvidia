import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createErrorResult,
  parseUpstreamError,
} from "../../open-sse/utils/error.js";
import {
  classifyQuotaScope,
  extractQuotaResetAtMs,
  fallbackQuotaResetAtMs,
  isProviderModelUnavailable,
} from "../../open-sse/utils/quotaLimits.js";

const NOW = new Date("2026-07-29T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reset-aware quota parsing", () => {
  it("extracts OpenRouter's millisecond reset from nested error metadata", async () => {
    const resetAtMs = NOW.getTime() + 6 * 60 * 60 * 1000;
    const response = Response.json({
      error: {
        message: "Rate limit exceeded: free-models-per-day",
        metadata: {
          headers: {
            "X-RateLimit-Reset": String(resetAtMs),
          },
        },
      },
    }, { status: 429 });

    await expect(parseUpstreamError(response)).resolves.toMatchObject({
      statusCode: 429,
      message: "Rate limit exceeded: free-models-per-day",
      resetsAtMs: resetAtMs,
    });
  });

  it("supports Retry-After seconds and HTTP-date values", () => {
    const seconds = new Response(null, {
      headers: { "Retry-After": "3600" },
    });
    expect(extractQuotaResetAtMs(seconds, null, NOW.getTime())).toBe(
      NOW.getTime() + 3_600_000,
    );

    const date = new Response(null, {
      headers: { "Retry-After": new Date(NOW.getTime() + 7_200_000).toUTCString() },
    });
    expect(extractQuotaResetAtMs(date, null, NOW.getTime())).toBe(
      NOW.getTime() + 7_200_000,
    );
  });

  it("preserves an upstream reset on the normalized error response", async () => {
    const resetAtMs = NOW.getTime() + 3_600_000;
    const result = createErrorResult(
      429,
      "Rate limit exceeded. Please try again later.",
      resetAtMs,
    );

    expect(result.response.headers.get("retry-after")).toBe("3600");
    await expect(result.response.json()).resolves.toMatchObject({
      retryAfter: new Date(resetAtMs).toISOString(),
    });
  });

  it("distinguishes provider-wide daily limits from model limits", () => {
    expect(classifyQuotaScope(
      "openrouter",
      429,
      "Rate limit exceeded: free-models-per-day",
    )).toBe("provider");
    expect(classifyQuotaScope(
      "openrouter",
      429,
      "This model is temporarily rate limited",
    )).toBe("model");
    expect(classifyQuotaScope(
      "opencode",
      429,
      "Rate limit exceeded. Please try again later.",
    )).toBe("provider");
  });

  it("uses a one-day fallback only for daily errors without reset metadata", () => {
    expect(fallbackQuotaResetAtMs(
      429,
      "Daily quota exceeded",
      NOW.getTime(),
    )).toBe(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(fallbackQuotaResetAtMs(
      429,
      "Requests per minute exceeded",
      NOW.getTime(),
    )).toBeNull();
  });

  it("classifies retired NVIDIA models and deleted NVIDIA functions as permanent model failures", () => {
    expect(isProviderModelUnavailable(
      410,
      "The model 'deepseek-ai/deepseek-v4-pro' has reached its end of life and is no longer available.",
    )).toBe(true);
    expect(isProviderModelUnavailable(
      404,
      "Function 'dead-id': Not found for account 'account-id'",
    )).toBe(true);
    expect(isProviderModelUnavailable(404, "ordinary missing web route")).toBe(false);
  });
});
