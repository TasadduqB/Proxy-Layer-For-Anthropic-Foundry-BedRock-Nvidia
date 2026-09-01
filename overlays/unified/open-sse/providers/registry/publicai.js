// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "publicai",
  priority: 200,
  hasFree: true,
  alias: "publicai",
  display: {
    name: "Publicai",
    icon: "bolt",
    color: "#4b37be",
    textIcon: "PU",
    notice: {
      text: "Free tier: 3 free models (one-time signup credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.publicai.co/v1/chat/completions",
    validateUrl: "https://api.publicai.co/v1/models",
  },
  models: [
    { id: "swiss-ai/apertus-70b-instruct", name: "swiss-ai/apertus-70b-instruct" },
    { id: "swiss-ai/Apertus-8B-Instruct-2509", name: "swiss-ai/Apertus-8B-Instruct-2509" },
    { id: "aisingapore/Qwen-SEA-LION-v4-32B-IT", name: "aisingapore/Qwen-SEA-LION-v4-32B-IT" },
    { id: "aisingapore/Gemma-SEA-LION-v4-27B-IT", name: "aisingapore/Gemma-SEA-LION-v4-27B-IT" },
    { id: "allenai/Olmo-3-32B-Think", name: "allenai/Olmo-3-32B-Think" },
    { id: "allenai/Olmo-3-7B-Instruct", name: "allenai/Olmo-3-7B-Instruct" },
    { id: "utter-project/EuroLLM-22B-Instruct-2512", name: "utter-project/EuroLLM-22B-Instruct-2512" }
  ],
  passthroughModels: false,
};
