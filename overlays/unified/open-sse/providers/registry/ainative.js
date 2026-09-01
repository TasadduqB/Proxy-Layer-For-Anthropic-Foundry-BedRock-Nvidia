// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "ainative",
  priority: 200,
  hasFree: true,
  alias: "ainative",
  display: {
    name: "Ainative",
    icon: "bolt",
    color: "#a5be37",
    textIcon: "AI",
    notice: {
      text: "Free tier: 9 free models (free, rate-limited (no published cap)).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.ainative.studio/api/v1/chat/completions",
    validateUrl: "https://api.ainative.studio/api/v1/models",
  },
  models: [
    { id: "qwen3-235b-cerebras", name: "Qwen3 235B (Cerebras)", contextLength: 131072, toolCalling: true },
    { id: "qwen3-32b", name: "Qwen3 32B", contextLength: 131072, toolCalling: true },
    { id: "qwen3-14b", name: "Qwen3 14B", contextLength: 131072, toolCalling: true },
    { id: "qwen3-8b", name: "Qwen3 8B", contextLength: 131072, toolCalling: true },
    { id: "llama-4-maverick", name: "Llama 4 Maverick", contextLength: 131072, toolCalling: true },
    { id: "llama3.1-8b-cerebras", name: "Llama 3.1 8B (Cerebras)", contextLength: 131072, toolCalling: true },
    { id: "deepseek-r1", name: "DeepSeek R1", contextLength: 65536, supportsReasoning: true },
    { id: "nous-coder", name: "Nous Coder", contextLength: 131072, toolCalling: true },
    { id: "gemini-flash", name: "Gemini Flash", contextLength: 131072, toolCalling: true }
  ],
  passthroughModels: true,
};
