// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "agentrouter",
  priority: 200,
  hasFree: true,
  alias: "agentrouter",
  display: {
    name: "Agentrouter",
    icon: "bolt",
    color: "#be375f",
    textIcon: "AG",
    notice: {
      text: "Free tier: 3 free models (one-time signup credit, ~200M token credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    validateUrl: "https://agentrouter.org/v1/messages",
  },
  models: [
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }
  ],
  passthroughModels: true,
};
