// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "aion",
  priority: 200,
  hasFree: true,
  alias: "aion",
  display: {
    name: "Aion",
    icon: "bolt",
    color: "#b7be37",
    textIcon: "AI",
    notice: {
      text: "Free tier: 5 free models (free, rate-limited (no published cap)).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.aionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.aionlabs.ai/v1/models",
  },
  models: [
    { id: "aion-labs/aion-3.0", name: "Aion 3.0", contextLength: 131072 },
    { id: "aion-labs/aion-3.0-mini", name: "Aion 3.0 Mini", contextLength: 131072 },
    { id: "aion-labs/aion-2.5", name: "Aion 2.5", contextLength: 131072 },
    { id: "aion-labs/aion-2.0", name: "Aion 2.0", contextLength: 131072 },
    { id: "aion-labs/aion-rp-llama-3.1-8b", name: "Aion RP Llama 3.1 8B", contextLength: 32768 }
  ],
  passthroughModels: true,
};
