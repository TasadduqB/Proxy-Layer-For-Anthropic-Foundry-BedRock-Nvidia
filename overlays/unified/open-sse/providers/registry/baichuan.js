// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "baichuan",
  priority: 200,
  hasFree: true,
  alias: "baichuan",
  display: {
    name: "Baichuan",
    icon: "bolt",
    color: "#37bebb",
    textIcon: "BA",
    notice: {
      text: "Free tier: 1 free model (one-time signup credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.baichuan-ai.com/v1/chat/completions",
    validateUrl: "https://api.baichuan-ai.com/v1/models",
  },
  models: [
    { id: "Baichuan4-Turbo", name: "Baichuan 4 Turbo", contextLength: 32768 },
    { id: "Baichuan4-Air", name: "Baichuan 4 Air", contextLength: 32768 },
    { id: "Baichuan4", name: "Baichuan 4" },
    { id: "Baichuan3-Turbo", name: "Baichuan 3 Turbo", contextLength: 32768 },
    { id: "Baichuan3-Turbo-128k", name: "Baichuan 3 Turbo 128k", contextLength: 131072 }
  ],
  passthroughModels: false,
};
