// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "longcat",
  priority: 200,
  hasFree: true,
  alias: "lc",
  display: {
    name: "Longcat",
    icon: "bolt",
    color: "#be3756",
    textIcon: "LO",
    notice: {
      text: "Free tier: 1 free model (one-time signup credit, ~10M token credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.longcat.chat/openai/v1/chat/completions",
    validateUrl: "https://api.longcat.chat/openai/v1/models",
  },
  models: [
    { id: "LongCat-2.0", name: "LongCat 2.0 (10M tok free 🆓)", contextLength: 1048576 }
  ],
  passthroughModels: false,
};
