export default {
  id: "sarvam",
  priority: 200,
  hasFree: true,
  alias: "sarvam",
  display: {
    name: "Sarvam AI",
    icon: "bolt",
    color: "#0a2e5c",
    textIcon: "SV",
    notice: {
      text: "Free tier: one-time signup credit (~₹1,000 / $12), no card required. Indian-language-focused models.",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.sarvam.ai/v1/chat/completions",
    authHeader: "api-subscription-key",
  },
  models: [
    { id: "sarvam-105b", name: "Sarvam 105B" },
    { id: "sarvam-105b-conversations", name: "Sarvam 105B Conversations" },
  ],
  serviceKinds: ["llm"],
};
