// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "liquid",
  priority: 200,
  hasFree: true,
  alias: "liquid",
  display: {
    name: "Liquid",
    icon: "bolt",
    color: "#52be37",
    textIcon: "LI",
    notice: {
      text: "Free tier: 1 free model (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://inference.liquid.ai/v1/chat/completions",
    validateUrl: "https://inference.liquid.ai/v1/models",
  },
  models: [
    { id: "liquid-lfm-40b", name: "Liquid LFM 40B" }
  ],
  passthroughModels: false,
};
