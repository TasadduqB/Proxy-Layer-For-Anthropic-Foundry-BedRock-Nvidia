// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "requesty",
  priority: 200,
  hasFree: true,
  alias: "requesty",
  display: {
    name: "Requesty",
    icon: "bolt",
    color: "#be9537",
    textIcon: "RE",
    notice: {
      text: "Free tier: 3 free models (free, rate-limited (no published cap)).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://router.requesty.ai/v1/chat/completions",
    validateUrl: "https://router.requesty.ai/v1/models",
  },
  models: [
    { id: "auto", name: "Auto" }
  ],
  passthroughModels: true,
};
