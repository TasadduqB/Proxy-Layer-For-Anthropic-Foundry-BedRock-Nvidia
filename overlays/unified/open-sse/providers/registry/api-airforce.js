// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "api-airforce",
  priority: 200,
  hasFree: true,
  alias: "af",
  display: {
    name: "Api Airforce",
    icon: "bolt",
    color: "#3776be",
    textIcon: "AA",
    notice: {
      text: "Free tier: 7 free models (daily free allowance, ~24M tokens/mo).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.airforce/v1/chat/completions",
    validateUrl: "https://api.airforce/v1/models",
  },
  models: [
    { id: "x-ai/grok-3", name: "Grok-3 (Free)", contextLength: 131072 },
    { id: "x-ai/grok-2-1212", name: "Grok-2 1212 (Free)", contextLength: 131072 },
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (Free)", contextLength: 200000 },
    { id: "qwen/qwen3-32b", name: "Qwen3 32B (Free)", contextLength: 128000 },
    { id: "moonshot/kimi-k2.6", name: "Kimi K2.6 (Free)", contextLength: 262144 },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash (Free)", contextLength: 1048576 },
    { id: "deepseek/deepseek-v3", name: "DeepSeek V3 (Free)", contextLength: 262144 }
  ],
  passthroughModels: false,
};
