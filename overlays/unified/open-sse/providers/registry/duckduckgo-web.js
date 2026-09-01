// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "duckduckgo-web",
  priority: 200,
  hasFree: true,
  alias: "ddgw",
  display: {
    name: "Duckduckgo Web",
    icon: "bolt",
    color: "#be37b3",
    textIcon: "DW",
    notice: {
      text: "Free tier: 6 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://duckduckgo.com/duckchat/v1/chat",
    validateUrl: "https://duckduckgo.com/duckchat/v1/chat",
  },
  models: [
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: "mistral-small-2603", name: "Mistral Small 4" },
    { id: "tinfoil/gpt-oss-120b", name: "gpt-oss 120B" },
    { id: "tinfoil/gemma4-31b", name: "Gemma 4 31B" }
  ],
  passthroughModels: false,
};
