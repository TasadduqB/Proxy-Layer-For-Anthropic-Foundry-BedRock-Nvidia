/**
 * Unit tests for cross-provider combo fallback on plain (non-combo) chat
 * requests (src/sse/handlers/chat.js).
 *
 * Root cause under test: a request for a single provider/model (not a combo
 * name) only ever rotated through that one provider's own accounts. If every
 * account for that provider was unavailable (disabled, rate-limited, out of
 * quota), the request failed even when the user had other healthy providers
 * configured — as long as those providers were never combined into a combo
 * that named this exact model.
 *
 * Fix: before giving up on an exhausted provider/model, look for any existing
 * combo that lists it as a member and retry against that combo's other
 * models (see handleSingleModelChat's `alreadyFellBackToCombo` guard for how
 * this is prevented from chaining recursively — that part is exercised by
 * manual/integration verification against the running server, since the
 * full chat.js module graph can't be loaded under this repo's current test
 * harness; see PR notes).
 */
import { describe, it, expect } from "vitest";
import { findComboFallbackModels } from "../../src/sse/handlers/comboFallback.js";

describe("findComboFallbackModels", () => {
  const combos = [
    { name: "claude-auto", models: ["tokenrouter/claude-sonnet-5", "azure/claude-sonnet-5", "nvidia/claude-sonnet-5"] },
    { name: "gpt-auto", models: ["azure/gpt-5", "nvidia/gpt-5"] },
    { name: "solo", models: ["onlyone/model-a"] },
  ];

  it("returns the other members of the first combo containing the model", () => {
    const result = findComboFallbackModels("tokenrouter/claude-sonnet-5", combos);
    expect(result).toEqual({
      comboName: "claude-auto",
      siblings: ["azure/claude-sonnet-5", "nvidia/claude-sonnet-5"],
    });
  });

  it("excludes the exhausted model itself from the returned siblings", () => {
    const result = findComboFallbackModels("azure/gpt-5", combos);
    expect(result.siblings).not.toContain("azure/gpt-5");
    expect(result.siblings).toEqual(["nvidia/gpt-5"]);
  });

  it("returns null when no combo lists the model", () => {
    expect(findComboFallbackModels("openai/gpt-5", combos)).toBeNull();
  });

  it("returns null when the model's only combo has no other members", () => {
    expect(findComboFallbackModels("onlyone/model-a", combos)).toBeNull();
  });

  it("is safe against missing/malformed input", () => {
    expect(findComboFallbackModels("", combos)).toBeNull();
    expect(findComboFallbackModels(null, combos)).toBeNull();
    expect(findComboFallbackModels("tokenrouter/claude-sonnet-5", null)).toBeNull();
    expect(findComboFallbackModels("tokenrouter/claude-sonnet-5", [])).toBeNull();
    expect(findComboFallbackModels("tokenrouter/claude-sonnet-5", [{ name: "x", models: null }])).toBeNull();
    expect(findComboFallbackModels("tokenrouter/claude-sonnet-5", [{ name: "x", models: "not-an-array" }])).toBeNull();
  });
});
