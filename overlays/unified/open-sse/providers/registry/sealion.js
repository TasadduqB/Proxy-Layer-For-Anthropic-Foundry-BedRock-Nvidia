// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "sealion",
  priority: 200,
  hasFree: true,
  alias: "sealion",
  display: {
    name: "Sealion",
    icon: "bolt",
    color: "#3e37be",
    textIcon: "SE",
    notice: {
      text: "Free tier: 5 free models (free, rate-limited (no published cap)).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.sea-lion.ai/v1/chat/completions",
    validateUrl: "https://api.sea-lion.ai/v1/models",
  },
  models: [
    { id: "aisingapore/Llama-SEA-LION-v3.5-70B-R", name: "Llama SEA-LION v3.5 70B R", contextLength: 131072 },
    { id: "aisingapore/Llama-SEA-LION-v3-70B-IT", name: "Llama SEA-LION v3 70B IT", contextLength: 131072 },
    { id: "aisingapore/Gemma-SEA-LION-v4-27B-IT", name: "Gemma SEA-LION v4 27B IT", contextLength: 131072 },
    { id: "aisingapore/Qwen-SEA-LION-v4.5-27B-IT", name: "Qwen SEA-LION v4.5 27B IT", contextLength: 32768 },
    { id: "aisingapore/Qwen-SEA-LION-v4-32B-IT", name: "Qwen SEA-LION v4 32B IT", contextLength: 32768 }
  ],
  passthroughModels: false,
};
