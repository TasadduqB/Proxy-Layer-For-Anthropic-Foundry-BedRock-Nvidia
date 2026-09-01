// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "ollama-cloud",
  priority: 200,
  hasFree: true,
  alias: "ollamacloud",
  display: {
    name: "Ollama Cloud",
    icon: "bolt",
    color: "#be375f",
    textIcon: "OC",
    notice: {
      text: "Free tier: 8 free models (monthly free allowance, ~20M tokens/mo).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://ollama.com/v1/chat/completions",
    validateUrl: "https://ollama.com/v1/models",
  },
  models: [
    { id: "gpt-oss:20b", name: "GPT-OSS 20B", supportsReasoning: true },
    { id: "gpt-oss:120b", name: "GPT-OSS 120B", supportsReasoning: true },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportsReasoning: true },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "glm-5.1", name: "GLM 5.1", supportsReasoning: true },
    { id: "glm-5.2", name: "GLM 5.2", supportsReasoning: true },
    { id: "minimax-m3", name: "MiniMax M3", contextLength: 1048576, supportsVision: true },
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
    { id: "gemma4:31b", name: "Gemma 4 31B" },
    { id: "nemotron-3-super", name: "NVIDIA Nemotron 3 Super" },
    { id: "qwen3.5:397b", name: "Qwen 3.5 397B" }
  ],
  passthroughModels: true,
};
