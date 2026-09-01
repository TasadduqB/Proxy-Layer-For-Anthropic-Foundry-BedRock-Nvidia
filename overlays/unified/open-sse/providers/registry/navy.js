// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "navy",
  priority: 200,
  hasFree: true,
  alias: "navy",
  display: {
    name: "Navy",
    icon: "bolt",
    color: "#83be37",
    textIcon: "NA",
    notice: {
      text: "Free tier: 1 free model (daily free allowance, ~5M tokens/mo).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.navy/v1/chat/completions",
    validateUrl: "https://api.navy/v1/models",
  },
  models: [
    { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct", contextLength: 131072, toolCalling: true },
    { id: "gemma-4-31b-it", name: "Gemma 4 31B IT", contextLength: 262144, toolCalling: true, supportsVision: true, supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 1048576, toolCalling: true, supportsReasoning: true },
    { id: "deepseek-chat", name: "DeepSeek Chat", contextLength: 131072, toolCalling: true },
    { id: "mistral-small-latest", name: "Mistral Small", contextLength: 262144, toolCalling: true, supportsVision: true, supportsReasoning: true },
    { id: "llama-4-scout", name: "Llama 4 Scout", contextLength: 10000000, toolCalling: true, supportsVision: true }
  ],
  passthroughModels: true,
};
