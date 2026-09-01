// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "kilo-gateway",
  priority: 200,
  hasFree: true,
  alias: "kg",
  display: {
    name: "Kilo Gateway",
    icon: "bolt",
    color: "#37a3be",
    textIcon: "KG",
    notice: {
      text: "Free tier: 13 free models (free, rate-limited (no published cap)).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.kilo.ai/api/gateway/chat/completions",
    validateUrl: "https://api.kilo.ai/api/gateway/models",
  },
  models: [
    { id: "kilo-auto/frontier", name: "Kilo Auto Frontier" },
    { id: "kilo-auto/balanced", name: "Kilo Auto Balanced" },
    { id: "kilo-auto/free", name: "Kilo Auto Free" },
    { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B (Free)" },
    { id: "minimax/minimax-m2.5:free", name: "MiniMax M2.5 (Free)" },
    { id: "arcee-ai/trinity-large-preview:free", name: "Trinity Large Preview (Free)" }
  ],
  passthroughModels: true,
};
