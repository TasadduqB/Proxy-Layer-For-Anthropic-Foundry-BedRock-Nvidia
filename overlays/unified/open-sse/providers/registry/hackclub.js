// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "hackclub",
  priority: 200,
  hasFree: true,
  alias: "hc",
  display: {
    name: "Hackclub",
    icon: "bolt",
    color: "#be6b37",
    textIcon: "HA",
    notice: {
      text: "Free tier: 3 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://ai.hackclub.com/proxy/v1/chat/completions",
    validateUrl: "https://ai.hackclub.com/proxy/v1/models",
  },
  models: [
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "mistralai/mistral-7b-instruct", name: "Mistral 7B" },
    { id: "deepseek-ai/deepseek-coder-33b", name: "DeepSeek Coder 33B" }
  ],
  passthroughModels: true,
};
