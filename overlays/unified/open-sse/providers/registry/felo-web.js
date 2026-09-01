// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "felo-web",
  priority: 200,
  hasFree: true,
  alias: "felo",
  display: {
    name: "Felo Web",
    icon: "bolt",
    color: "#b3be37",
    textIcon: "FW",
    notice: {
      text: "Free tier: 5 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://felo.ai/api-proxy/main/search/threads",
    validateUrl: "https://felo.ai/api-proxy/main/search/threads",
  },
  models: [
    { id: "felo-chat", name: "Felo Chat" },
    { id: "felo-search", name: "Felo Search" },
    { id: "felo-scholar", name: "Felo Scholar" },
    { id: "felo-social", name: "Felo Social" },
    { id: "felo-document", name: "Felo Document" }
  ],
  passthroughModels: false,
};
