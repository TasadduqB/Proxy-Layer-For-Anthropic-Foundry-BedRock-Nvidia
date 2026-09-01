// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "monsterapi",
  priority: 200,
  hasFree: true,
  alias: "monster",
  display: {
    name: "Monsterapi",
    icon: "bolt",
    color: "#be3791",
    textIcon: "MO",
    notice: {
      text: "Free tier: 1 free model (one-time signup credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.monsterapi.ai/v1/chat/completions",
    validateUrl: "https://api.monsterapi.ai/v1/models",
  },
  models: [
    { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B Instruct" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" }
  ],
  passthroughModels: false,
};
