import { describe, expect, it } from "vitest";

import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

describe("free provider model filters", () => {
  it("includes every zero-price OpenRouter model regardless of context window", () => {
    const models = [
      {
        id: "small/free",
        name: "Small Free",
        context_length: 32_000,
        pricing: { prompt: "0", completion: "0" },
      },
      {
        id: "numeric/free",
        context_length: 128_000,
        pricing: { prompt: 0, completion: 0 },
      },
      {
        id: "paid/model",
        context_length: 1_000_000,
        pricing: { prompt: "0.000001", completion: "0" },
      },
    ];

    expect(FILTERS["openrouter-free"](models)).toEqual([
      { id: "numeric/free", name: "numeric/free", contextLength: 128_000 },
      { id: "small/free", name: "Small Free", contextLength: 32_000 },
    ]);
  });

  it("includes OpenCode free suffixes and the documented big-pickle model", () => {
    expect(FILTERS["opencode-free"]([
      { id: "big-pickle" },
      { id: "ling-3.0-flash-free", name: "Ling" },
      { id: "paid-model" },
    ])).toEqual([
      { id: "big-pickle", name: "big-pickle" },
      { id: "ling-3.0-flash-free", name: "Ling" },
    ]);
  });

  it("returns an empty list for malformed provider responses", () => {
    expect(FILTERS["openrouter-free"](null)).toEqual([]);
    expect(FILTERS["opencode-free"]({ data: [] })).toEqual([]);
  });
});
