// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "uncloseai",
  priority: 200,
  hasFree: true,
  alias: "unc",
  display: {
    name: "Uncloseai",
    icon: "bolt",
    color: "#be3739",
    textIcon: "UN",
    notice: {
      text: "Free tier: 3 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://hermes.ai.unturf.com/v1/chat/completions",
    validateUrl: "https://hermes.ai.unturf.com/v1/models",
  },
  models: [
    { id: "adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic", name: "Hermes 3 Llama 3.1 8B (🆓 Free)" },
    { id: "qwen3.6:27b", name: "Qwen3 Coder 27B (🆓 Free)" },
    { id: "gemma4:31b", name: "Gemma 4 31B (🆓 Free)" }
  ],
  passthroughModels: false,
};
