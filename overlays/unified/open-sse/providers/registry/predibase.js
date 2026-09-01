// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "predibase",
  priority: 200,
  hasFree: true,
  alias: "predibase",
  display: {
    name: "Predibase",
    icon: "bolt",
    color: "#37be39",
    textIcon: "PR",
    notice: {
      text: "Free tier: 1 free model (one-time signup credit, ~25M token credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://serving.app.predibase.com/v1/chat/completions",
    validateUrl: "https://serving.app.predibase.com/v1/models",
  },
  models: [
    { id: "llama-3.3-70b", name: "llama-3.3-70b" }
  ],
  passthroughModels: false,
};
