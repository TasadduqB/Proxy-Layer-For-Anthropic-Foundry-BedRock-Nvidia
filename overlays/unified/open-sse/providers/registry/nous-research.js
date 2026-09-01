// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "nous-research",
  priority: 200,
  hasFree: true,
  alias: "nous",
  display: {
    name: "Nous Research",
    icon: "bolt",
    color: "#37be5d",
    textIcon: "NR",
    notice: {
      text: "Free tier: 2 free models (recurring free credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    validateUrl: "https://inference-api.nousresearch.com/v1/models",
  },
  models: [
    { id: "Hermes-4-405B", name: "Hermes 4 7B (Nous Research)" },
    { id: "Hermes-4-70B", name: "Hermes 4 70B (Nous Research)" }
  ],
  passthroughModels: false,
};
