// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "morph",
  priority: 200,
  hasFree: true,
  alias: "morph",
  display: {
    name: "Morph",
    icon: "bolt",
    color: "#37be91",
    textIcon: "MO",
    notice: {
      text: "Free tier: 2 free models (monthly free allowance, ~0M tokens/mo).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.morphllm.com/v1/chat/completions",
    validateUrl: "https://api.morphllm.com/v1/models",
  },
  models: [
    { id: "morph-v3-large", name: "morph-v3-large" },
    { id: "morph-v3-fast", name: "morph-v3-fast" },
    { id: "morph-glm52-744b", name: "GLM-5.2 744B (Morph)", contextLength: 1048576 },
    { id: "morph-qwen35-397b", name: "Qwen 3.5 397B (Morph)", contextLength: 262144 },
    { id: "morph-qwen36-27b", name: "Qwen 3.6 27B (Morph)", contextLength: 131072 },
    { id: "morph-minimax3-428b", name: "MiniMax M3 (Morph)", contextLength: 262144 },
    { id: "morph-dsv4flash", name: "DeepSeek V4 Flash (Morph)", contextLength: 1048576 }
  ],
  passthroughModels: false,
};
