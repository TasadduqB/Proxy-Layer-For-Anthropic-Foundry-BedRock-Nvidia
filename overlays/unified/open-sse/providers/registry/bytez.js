// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "bytez",
  priority: 200,
  hasFree: true,
  alias: "bytez",
  display: {
    name: "Bytez",
    icon: "bolt",
    color: "#5f37be",
    textIcon: "BY",
    notice: {
      text: "Free tier: 3 free models (recurring free credit, ~1M token credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.bytez.com/models/v2/openai/v1/chat/completions",
    validateUrl: "https://api.bytez.com/models/v2/openai/v1/models",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" },
    { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "mistralai/Mistral-7B-Instruct-v0.3" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen/Qwen2.5-72B-Instruct" }
  ],
  passthroughModels: false,
};
