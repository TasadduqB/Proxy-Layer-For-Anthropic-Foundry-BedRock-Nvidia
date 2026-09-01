// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "aihorde",
  priority: 200,
  hasFree: true,
  alias: "aihorde",
  display: {
    name: "Aihorde",
    icon: "bolt",
    color: "#ac37be",
    textIcon: "AI",
    notice: {
      text: "Free tier: 3 free models (free, no API key required).",
    },
  },
  category: "free",
  transport: {
    baseUrl: "https://oai.aihorde.net/v1/chat/completions",
    validateUrl: "https://oai.aihorde.net/v1/models",
  },
  models: [
    { id: "aphrodite/TheDrummer/Cydonia-24B-v4.3", name: "Cydonia 24B (AI Horde)", contextLength: 32768 },
    { id: "aphrodite/TheDrummer/Skyfall-31B-v4.2", name: "Skyfall 31B (AI Horde)", contextLength: 32768 },
    { id: "google/gemma-4-31b", name: "Gemma 4 31B (AI Horde)", contextLength: 32768 }
  ],
  passthroughModels: true,
};
