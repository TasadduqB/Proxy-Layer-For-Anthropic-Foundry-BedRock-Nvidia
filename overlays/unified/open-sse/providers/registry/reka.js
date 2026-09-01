// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "reka",
  priority: 200,
  hasFree: true,
  alias: "reka",
  display: {
    name: "Reka",
    icon: "bolt",
    color: "#be377d",
    textIcon: "RE",
    notice: {
      text: "Free tier: 2 free models (monthly free allowance).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.reka.ai/v1/chat/completions",
    validateUrl: "https://api.reka.ai/v1/models",
  },
  models: [
    { id: "reka-flash-3", name: "Reka Flash 3" },
    { id: "reka-flash", name: "Reka Flash" },
    { id: "reka-edge-2603", name: "Reka Edge 2603" }
  ],
  passthroughModels: false,
};
