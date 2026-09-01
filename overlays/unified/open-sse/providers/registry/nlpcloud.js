// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "nlpcloud",
  priority: 200,
  hasFree: true,
  alias: "nlpc",
  display: {
    name: "Nlpcloud",
    icon: "bolt",
    color: "#be3e37",
    textIcon: "NL",
    notice: {
      text: "Free tier: 1 free model (monthly free allowance).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.nlpcloud.io/v1/chat/completions",
    validateUrl: "https://api.nlpcloud.io/v1/models",
  },
  models: [
    { id: "chatdolphin", name: "ChatDolphin", contextLength: 8192 },
    { id: "dolphin", name: "Dolphin", contextLength: 16384 },
    { id: "finetuned-llama-3-70b", name: "Fine-tuned LLaMA 3.3 70B" },
    { id: "llama-3-1-405b", name: "LLaMA 3.1 405B" },
    { id: "llama-3-8b-instruct", name: "Llama 3 8B" }
  ],
  passthroughModels: false,
};
