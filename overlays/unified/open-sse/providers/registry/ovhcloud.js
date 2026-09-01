// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "ovhcloud",
  priority: 200,
  hasFree: true,
  alias: "ovh",
  display: {
    name: "Ovhcloud",
    icon: "bolt",
    color: "#37be52",
    textIcon: "OV",
    notice: {
      text: "Free tier: 5 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    validateUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models",
  },
  models: [
    { id: "Meta-Llama-3_3-70B-Instruct", name: "Meta-Llama-3_3-70B-Instruct" },
    { id: "Qwen2.5-Coder-32B-Instruct", name: "Qwen2.5-Coder-32B-Instruct" },
    { id: "Mistral-Small-3.2-24B-Instruct-2506", name: "Mistral-Small-3.2-24B-Instruct-2506" }
  ],
  passthroughModels: false,
};
