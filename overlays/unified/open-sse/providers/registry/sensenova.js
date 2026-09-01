// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "sensenova",
  priority: 200,
  hasFree: true,
  alias: "sensenova",
  display: {
    name: "Sensenova",
    icon: "bolt",
    color: "#3756be",
    textIcon: "SE",
    notice: {
      text: "Free tier: 1 free model (one-time signup credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    validateUrl: "https://token.sensenova.cn/v1/models",
  },
  models: [
    { id: "sensenova-6.7-flash-lite", name: "SenseNova 6.7 Flash-Lite", contextLength: 262144, toolCalling: true, supportsVision: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 1048576, supportsReasoning: true },
    { id: "glm-5.2", name: "GLM 5.2", contextLength: 1048576, supportsReasoning: true }
  ],
  passthroughModels: false,
};
