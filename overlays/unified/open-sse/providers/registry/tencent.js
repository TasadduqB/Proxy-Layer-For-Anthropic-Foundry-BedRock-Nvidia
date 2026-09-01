// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "tencent",
  priority: 200,
  hasFree: true,
  alias: "tencent",
  display: {
    name: "Tencent",
    icon: "bolt",
    color: "#37aabe",
    textIcon: "TE",
    notice: {
      text: "Free tier: 1 free model (free, rate-limited (no published cap)).",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    validateUrl: "https://api.hunyuan.cloud.tencent.com/v1/models",
  },
  models: [
    { id: "hunyuan-turbos-latest", name: "Hunyuan TurboS Latest", contextLength: 200000 },
    { id: "hunyuan-t1-latest", name: "Hunyuan T1 Latest", contextLength: 256000 },
    { id: "hunyuan-pro", name: "Hunyuan Pro" },
    { id: "hunyuan-vision", name: "Hunyuan Vision" },
    { id: "hunyuan-functioncall", name: "Hunyuan FunctionCall" },
    { id: "hunyuan-lite", name: "Hunyuan Lite" }
  ],
  passthroughModels: false,
};
