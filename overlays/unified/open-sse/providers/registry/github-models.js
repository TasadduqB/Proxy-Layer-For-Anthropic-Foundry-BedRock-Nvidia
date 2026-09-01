// GitHub Models — free inference for any GitHub account via a personal access
// token, distinct from registry/github.js (the OAuth Copilot-chat shim at
// api.githubcopilot.com, a different auth flow and different backend).
export default {
  id: "github-models",
  priority: 200,
  hasFree: true,
  alias: "github-models",
  display: {
    name: "GitHub Models",
    icon: "bolt",
    color: "#24292f",
    textIcon: "GM",
    notice: {
      text: "Free tier: any GitHub account, PAT-authenticated. Rate limits scale with your Copilot plan (free plan is the lowest tier, no card required).",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://models.github.ai/inference/chat/completions",
  },
  models: [
    { id: "openai/gpt-4.1", name: "GPT-4.1 (GitHub Models)" },
    { id: "deepseek/DeepSeek-V3-0324", name: "DeepSeek V3 0324 (GitHub Models)", supportsReasoning: true },
    { id: "meta/Llama-4-Scout-17B-16E-Instruct", name: "Llama 4 Scout 17B (GitHub Models)" },
  ],
  serviceKinds: ["llm"],
};
