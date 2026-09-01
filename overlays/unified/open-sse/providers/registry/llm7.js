// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "llm7",
  priority: 200,
  hasFree: true,
  alias: "llm7",
  display: {
    name: "Llm7",
    icon: "bolt",
    color: "#bea737",
    textIcon: "LL",
    notice: {
      text: "Free tier: 4 free models (daily free allowance, ~150M tokens/mo).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.llm7.io/v1/chat/completions",
    validateUrl: "https://api.llm7.io/v1/models",
  },
  models: [
    { id: "gpt-4o-mini-2024-07-18", name: "GPT-4o mini (LLM7)" },
    { id: "gpt-4.1-nano-2025-04-14", name: "GPT-4.1 nano (LLM7)" },
    { id: "deepseek-r1-0528", name: "DeepSeek R1 (LLM7)" },
    { id: "qwen2.5-coder-32b-instruct", name: "Qwen2.5 Coder 32B (LLM7)" }
  ],
  passthroughModels: false,
};
