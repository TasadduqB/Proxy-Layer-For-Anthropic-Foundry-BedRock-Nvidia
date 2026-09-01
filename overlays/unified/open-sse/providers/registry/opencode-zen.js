// Adapted from OmniRoute (https://github.com/diegosouzapw/OmniRoute, MIT License,
// Copyright (c) 2026 diegosouzapw). See THIRD_PARTY_NOTICES.md.
export default {
  id: "opencode-zen",
  priority: 200,
  hasFree: true,
  alias: "opencode-zen",
  display: {
    name: "Opencode Zen",
    icon: "bolt",
    color: "#be3798",
    textIcon: "OZ",
    notice: {
      text: "Free tier: a small subset of the catalog (models with a \"-free\" ID suffix), rate-limited (no published cap). Most listed models are paid.",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://opencode.ai/zen/v1",
    validateUrl: "https://opencode.ai/zen/v1",
  },
  // Fallback only — passthroughModels below means the live catalog fetched
  // from opencode.ai/zen/v1/models is what's actually served; this array is
  // used only if that fetch fails. Live models carry an explicit
  // "-free"/"contributor-free" ID suffix to mark the free subset (opencode.ai
  // exposes ~65 models total, most of them paid) — this fallback must list
  // only those, not the paid catalog, or a failed fetch would silently offer
  // paid models as if they were free.
  models: [
    { id: "big-pickle", name: "Big Pickle", supportsReasoning: true },
    { id: "mimo-v2.5-free", name: "MiMo V2.5 Free" },
    { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free" },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", supportsReasoning: true },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" },
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 (Contributor Free)" },
    { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", supportsReasoning: true },
  ],
  passthroughModels: true,
};
