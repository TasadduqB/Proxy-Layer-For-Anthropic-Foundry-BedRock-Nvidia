// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "freemodel-dev",
  priority: 200,
  hasFree: true,
  alias: "fmd",
  display: {
    name: "Freemodel Dev",
    icon: "bolt",
    color: "#50be37",
    textIcon: "FD",
    notice: {
      text: "Free tier: 4 free models (one-time signup credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.freemodel.dev/v1/chat/completions",
    validateUrl: "https://api.freemodel.dev/v1/models",
  },
  models: [
    { id: "gpt-5.5", name: "GPT-5.5", contextLength: 400000 },
    { id: "gpt-5.4", name: "GPT-5.4", contextLength: 400000 },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" }
  ],
  passthroughModels: false,
};
