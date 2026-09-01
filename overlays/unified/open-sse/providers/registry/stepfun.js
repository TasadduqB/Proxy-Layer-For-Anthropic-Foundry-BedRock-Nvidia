// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "stepfun",
  priority: 200,
  hasFree: true,
  alias: "stepfun",
  display: {
    name: "Stepfun",
    icon: "bolt",
    color: "#bb37be",
    textIcon: "ST",
    notice: {
      text: "Free tier: 1 free model (one-time signup credit).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.stepfun.com/v1/chat/completions",
    validateUrl: "https://api.stepfun.com/v1/models",
  },
  models: [
    { id: "step-3.7-flash", name: "Step 3.7 Flash", contextLength: 262144 },
    { id: "step-3.5-flash", name: "Step 3.5 Flash", contextLength: 262144 },
    { id: "step-3.5-flash-2603", name: "Step 3.5 Flash 2603", contextLength: 262144 },
    { id: "step-1o-turbo-vision", name: "Step 1o Turbo Vision", contextLength: 32768 },
    { id: "step-1v", name: "Step 1V" }
  ],
  passthroughModels: false,
};
