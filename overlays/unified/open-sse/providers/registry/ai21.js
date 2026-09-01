// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "ai21",
  priority: 200,
  hasFree: true,
  alias: "ai21",
  display: {
    name: "Ai21",
    icon: "bolt",
    color: "#7d37be",
    textIcon: "AI",
    notice: {
      text: "Free tier: 2 free models (one-time signup credit, ~10M token credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    validateUrl: "https://api.ai21.com/studio/v1/models",
  },
  models: [
    { id: "jamba-large-1.7", name: "jamba-large-1.7" },
    { id: "jamba-mini-2", name: "jamba-mini-2" }
  ],
  passthroughModels: false,
};
