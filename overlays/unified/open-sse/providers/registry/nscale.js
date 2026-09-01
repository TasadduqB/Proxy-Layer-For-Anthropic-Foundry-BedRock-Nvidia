// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "nscale",
  priority: 200,
  hasFree: true,
  alias: "nscale",
  display: {
    name: "Nscale",
    icon: "bolt",
    color: "#be37be",
    textIcon: "NS",
    notice: {
      text: "Free tier: 6 free models (one-time signup credit, ~5M token credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://inference.api.nscale.com/v1/chat/completions",
    validateUrl: "https://inference.api.nscale.com/v1/models",
  },
  models: [
    { id: "moonshotai/Kimi-K2.5", name: "moonshotai/Kimi-K2.5" },
    { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen/Qwen3-235B-A22B-Instruct-2507" },
    { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b" },
    { id: "openai/gpt-oss-20b", name: "openai/gpt-oss-20b" },
    { id: "meta-llama/Llama-4-Scout-17B-16E-Instruct", name: "meta-llama/Llama-4-Scout-17B-16E-Instruct" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" }
  ],
  passthroughModels: false,
};
