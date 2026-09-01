// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "sambanova",
  priority: 200,
  hasFree: true,
  alias: "samba",
  display: {
    name: "Sambanova",
    icon: "bolt",
    color: "#56be37",
    textIcon: "SA",
    notice: {
      text: "Free tier: 5 free models (daily free allowance, ~6M tokens/mo).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.sambanova.ai/v1/chat/completions",
    validateUrl: "https://api.sambanova.ai/v1/models",
  },
  models: [
    { id: "MiniMax-M2.7", name: "MiniMax-M2.7" },
    { id: "DeepSeek-V3.2", name: "DeepSeek-V3.2" },
    { id: "Llama-4-Maverick-17B-128E-Instruct", name: "Llama-4-Maverick-17B-128E-Instruct" },
    { id: "Meta-Llama-3.3-70B-Instruct", name: "Meta-Llama-3.3-70B-Instruct" },
    { id: "gpt-oss-120b", name: "gpt-oss-120b" }
  ],
  passthroughModels: false,
};
