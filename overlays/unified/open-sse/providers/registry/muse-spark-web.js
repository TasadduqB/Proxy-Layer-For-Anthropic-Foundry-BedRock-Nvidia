// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "muse-spark-web",
  priority: 200,
  hasFree: true,
  alias: "ms-web",
  display: {
    name: "Muse Spark Web",
    icon: "bolt",
    color: "#be5d37",
    textIcon: "MS",
    notice: {
      text: "Free tier: 3 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://www.meta.ai/api/graphql",
    validateUrl: "https://www.meta.ai/api/graphql",
  },
  models: [
    { id: "muse-spark", name: "Muse Spark" },
    { id: "muse-spark-thinking", name: "Muse Spark Thinking", supportsReasoning: true },
    { id: "muse-spark-contemplating", name: "Muse Spark Contemplating", supportsReasoning: true }
  ],
  passthroughModels: false,
};
