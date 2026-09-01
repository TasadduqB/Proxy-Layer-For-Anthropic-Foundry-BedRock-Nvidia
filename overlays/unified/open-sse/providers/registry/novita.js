// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "novita",
  priority: 200,
  hasFree: true,
  alias: "novita",
  display: {
    name: "Novita",
    icon: "bolt",
    color: "#b737be",
    textIcon: "NO",
    notice: {
      text: "Free tier: 1 free model (one-time signup credit, ~1M token credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.novita.ai/openai/v1/chat/completions",
    validateUrl: "https://api.novita.ai/openai/v1/models",
  },
  models: [
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 1048576, supportsReasoning: true },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 1048576, supportsReasoning: true },
    { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", contextLength: 163840, supportsReasoning: true },
    { id: "moonshotai/kimi-k3", name: "Kimi K3", contextLength: 1048576, supportsVision: true, supportsReasoning: true },
    { id: "moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code", contextLength: 262144, supportsVision: true, supportsReasoning: true },
    { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6", contextLength: 262144, supportsVision: true, supportsReasoning: true },
    { id: "zai-org/glm-5.2", name: "GLM 5.2", contextLength: 1048576, supportsReasoning: true },
    { id: "zai-org/glm-5.1", name: "GLM 5.1", contextLength: 204800, supportsReasoning: true },
    { id: "zai-org/glm-4.7", name: "GLM 4.7", contextLength: 204800, supportsReasoning: true },
    { id: "minimax/minimax-m3", name: "MiniMax M3", contextLength: 1000000, supportsVision: true, supportsReasoning: true },
    { id: "minimax/minimax-m2.7", name: "MiniMax M2.7", contextLength: 204800, supportsReasoning: true },
    { id: "qwen/qwen3.7-max", name: "Qwen3.7 Max", contextLength: 1000000, supportsReasoning: true },
    { id: "qwen/qwen3.6-plus", name: "Qwen3.6 Plus", contextLength: 1000000, supportsVision: true, supportsReasoning: true },
    { id: "qwen/qwen3.5-397b-a17b", name: "Qwen3.5 397B A17B", contextLength: 262144, supportsVision: true, supportsReasoning: true },
    { id: "qwen/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B", contextLength: 262144 },
    { id: "xiaomimimo/mimo-v2.5-pro", name: "MiMo V2.5 Pro", contextLength: 1048576, supportsReasoning: true },
    { id: "openai/gpt-oss-120b", name: "OpenAI gpt-oss-120b", contextLength: 131072, supportsReasoning: true },
    { id: "google/gemma-4-31b-it", name: "Gemma 4 31B", contextLength: 262144, supportsVision: true, supportsReasoning: true },
    { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct", contextLength: 16384 }
  ],
  passthroughModels: false,
};
