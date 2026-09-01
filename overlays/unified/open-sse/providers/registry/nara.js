// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "nara",
  priority: 200,
  hasFree: true,
  alias: "nara",
  display: {
    name: "Nara",
    icon: "bolt",
    color: "#b937be",
    textIcon: "NA",
    notice: {
      text: "Free tier: 3 free models (daily free allowance, ~150M tokens/mo).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://router.bynara.id/v1/chat/completions",
    validateUrl: "https://router.bynara.id/v1/models",
  },
  models: [
    { id: "tencent-hy3", name: "Tencent Hy3", contextLength: 1000000 },
    { id: "mistral-large", name: "Mistral Large", contextLength: 252000, toolCalling: true },
    { id: "mistral-medium-3-5", name: "Mistral Medium 3.5", contextLength: 256000, toolCalling: true, supportsVision: true }
  ],
  passthroughModels: false,
};
