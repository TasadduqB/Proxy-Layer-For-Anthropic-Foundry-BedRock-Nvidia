// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "agnes",
  priority: 200,
  hasFree: true,
  alias: "agnes",
  display: {
    name: "Agnes",
    icon: "bolt",
    color: "#9e37be",
    textIcon: "AG",
    notice: {
      text: "Free tier: 2 free models (free, rate-limited (no published cap)).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/responses",
    validateUrl: "https://apihub.agnes-ai.com/v1/responses",
  },
  models: [
    { id: "agnes-2.5-pro", name: "Agnes 2.5 Pro", contextLength: 1048576, toolCalling: true, supportsVision: true, supportsReasoning: true },
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", contextLength: 524288, toolCalling: true, supportsVision: true, supportsReasoning: true }
  ],
  passthroughModels: false,
};
