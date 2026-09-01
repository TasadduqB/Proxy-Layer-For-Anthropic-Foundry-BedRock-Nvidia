// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "scaleway",
  priority: 200,
  hasFree: true,
  alias: "scw",
  display: {
    name: "Scaleway",
    icon: "bolt",
    color: "#86be37",
    textIcon: "SC",
    notice: {
      text: "Free tier: 6 free models (one-time signup credit, ~1M token credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.scaleway.ai/v1/chat/completions",
    validateUrl: "https://api.scaleway.ai/v1/models",
  },
  models: [
    { id: "qwen3-235b-a22b-instruct-2507", name: "Qwen3 235B A22B (1M free tok 🆓)" },
    { id: "llama-3.1-70b-instruct", name: "Llama 3.1 70B (🆓 EU)" },
    { id: "llama-3.1-8b-instruct", name: "Llama 3.1 8B (🆓 EU)" },
    { id: "mistral-small-3.2-24b-instruct-2506", name: "Mistral Small 3.2 (🆓 EU)" },
    { id: "deepseek-v3-0324", name: "DeepSeek V3 (🆓 EU)" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B (🆓 EU)" }
  ],
  passthroughModels: false,
};
