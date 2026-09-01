// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "friendliai",
  priority: 200,
  hasFree: true,
  alias: "friendli",
  display: {
    name: "Friendliai",
    icon: "bolt",
    color: "#be9837",
    textIcon: "FR",
    notice: {
      text: "Free tier: 2 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://api.friendli.ai/serverless/v1/chat/completions",
    validateUrl: "https://api.friendli.ai/serverless/v1/models",
  },
  models: [
    { id: "meta-llama-3.1-70b-instruct", name: "meta-llama-3.1-70b-instruct" },
    { id: "meta-llama-3.1-8b-instruct", name: "meta-llama-3.1-8b-instruct" }
  ],
  passthroughModels: false,
};
