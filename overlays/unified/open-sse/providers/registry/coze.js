// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "coze",
  priority: 200,
  hasFree: true,
  alias: "coze",
  display: {
    name: "Coze",
    icon: "bolt",
    color: "#375dbe",
    textIcon: "CO",
    notice: {
      text: "Free tier: 1 free model (daily free allowance).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.coze.com/v1/chat/completions",
    validateUrl: "https://api.coze.com/v1/models",
  },
  models: [
    { id: "claude-3-7-sonnet-20250514", name: "Claude 3.7 Sonnet" }
  ],
  passthroughModels: false,
};
