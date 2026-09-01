// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "qwen-web",
  priority: 200,
  hasFree: true,
  alias: "qwen-web",
  display: {
    name: "Qwen Web",
    icon: "bolt",
    color: "#5fbe37",
    textIcon: "QW",
    notice: {
      text: "Free tier: 4 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://chat.qwen.ai/api/v2/chat/completions",
    validateUrl: "https://chat.qwen.ai/api/v2/models",
  },
  models: [
    { id: "qwen3.8-max-preview", name: "Qwen3.8 Max Preview", contextLength: 1000000, supportsVision: true, supportsReasoning: true },
    { id: "qwen3.7-max", name: "Qwen3.7 Max", contextLength: 1000000, supportsReasoning: true },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus", contextLength: 1000000, supportsVision: true, supportsReasoning: true },
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus", contextLength: 1000000, supportsVision: true, supportsReasoning: true }
  ],
  passthroughModels: false,
};
