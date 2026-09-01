// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "sparkdesk",
  priority: 200,
  hasFree: true,
  alias: "sparkdesk",
  display: {
    name: "Sparkdesk",
    icon: "bolt",
    color: "#be5637",
    textIcon: "SP",
    notice: {
      text: "Free tier: 1 free model (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://spark-api-open.xf-yun.com/v1/chat/completions",
    validateUrl: "https://spark-api-open.xf-yun.com/v1/models",
  },
  models: [
    { id: "4.0Ultra", name: "Spark 4.0 Ultra", contextLength: 32768 },
    { id: "generalv3", name: "Spark Pro", contextLength: 8192 },
    { id: "pro-128k", name: "Spark Pro 128K", contextLength: 131072 },
    { id: "lite", name: "Spark Lite", contextLength: 4096 }
  ],
  passthroughModels: false,
};
