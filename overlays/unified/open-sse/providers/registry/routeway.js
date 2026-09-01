// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "routeway",
  priority: 200,
  hasFree: true,
  alias: "routeway",
  display: {
    name: "Routeway",
    icon: "bolt",
    color: "#37be68",
    textIcon: "RO",
    notice: {
      text: "Free tier: 8 free models (free, rate-limited (no published cap)).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.routeway.ai/v1/chat/completions",
    validateUrl: "https://api.routeway.ai/v1/models",
  },
  models: [
    { id: "llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct (free)", contextLength: 131072, toolCalling: true },
    { id: "nemotron-3-nano-30b-a3b:free", name: "Nemotron 3 Nano 30B (free)", contextLength: 256000, toolCalling: true },
    { id: "nemotron-nano-9b-v2:free", name: "Nemotron Nano 9B v2 (free)", contextLength: 128000, toolCalling: true },
    { id: "step-3.7-flash:free", name: "Step 3.7 Flash (free)", contextLength: 256000, toolCalling: true, supportsVision: true },
    { id: "step-3.5-flash:free", name: "Step 3.5 Flash (free)", contextLength: 65536, toolCalling: true },
    { id: "laguna-m.1:free", name: "Laguna M.1 (free)", contextLength: 131072, toolCalling: true },
    { id: "laguna-xs.2:free", name: "Laguna XS.2 (free)", contextLength: 131072, toolCalling: true },
    { id: "llama-3.2-3b-instruct:free", name: "Llama 3.2 3B Instruct (free)", contextLength: 16000, toolCalling: true }
  ],
  passthroughModels: true,
};
