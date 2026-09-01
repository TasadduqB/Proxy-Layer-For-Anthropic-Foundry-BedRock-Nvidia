// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "inference-net",
  priority: 200,
  hasFree: true,
  alias: "inet",
  display: {
    name: "Inference Net",
    icon: "bolt",
    color: "#be376b",
    textIcon: "IN",
    notice: {
      text: "Free tier: 3 free models (monthly free allowance).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.inference.net/v1/chat/completions",
    validateUrl: "https://api.inference.net/v1/models",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" },
    { id: "deepseek-ai/DeepSeek-R1", name: "deepseek-ai/DeepSeek-R1" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen/Qwen2.5-72B-Instruct" }
  ],
  passthroughModels: false,
};
