import { describe, expect, it } from "vitest";
import { canonicalizeUsage, normalizeUsage } from "../../open-sse/utils/usageTracking.js";

describe("provider cache-write accounting", () => {
  it("normalizes OpenRouter Chat Completions cache_write_tokens", () => {
    const normalized = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 20,
      prompt_tokens_details: {
        cached_tokens: 600,
        cache_write_tokens: 128,
      },
      cached_tokens: 600,
    });
    const usage = canonicalizeUsage(normalized);

    expect(usage.prompt_tokens).toBe(1000);
    expect(usage.cached_tokens).toBe(600);
    expect(usage.cache_creation_input_tokens).toBe(128);
    expect(usage.total_tokens).toBe(1020);
  });

  it("normalizes Responses API input_tokens_details cache writes", () => {
    const usage = canonicalizeUsage(normalizeUsage({
      prompt_tokens: 2048,
      completion_tokens: 32,
      cached_tokens: 1024,
      input_tokens_details: {
        cached_tokens: 1024,
        cache_write_tokens: 256,
      },
    }));

    expect(usage.cached_tokens).toBe(1024);
    expect(usage.cache_creation_input_tokens).toBe(256);
  });
});
